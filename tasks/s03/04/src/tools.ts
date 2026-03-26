import { maxOutputBytes, minOutputBytes } from './config.js';
import { findBestItems, getCityNamesForItem, loadDataStore, normalizeText, type DataStore, type Item } from './data.js';
import { interpretItemFromQuery } from './ai.js';
import { logError, logInfo } from './logger.js';

const encoder = new TextEncoder();

export interface ToolRequestBody {
  params?: unknown;
}

function extractQuery(params: unknown): string {
  if (typeof params === 'string') {
    return params.trim();
  }

  if (!params || typeof params !== 'object') {
    return '';
  }

  const obj = params as { params?: unknown; query?: unknown; text?: unknown };
  if (typeof obj.params === 'string') {
    return obj.params.trim();
  }
  if (typeof obj.query === 'string') {
    return obj.query.trim();
  }
  if (typeof obj.text === 'string') {
    return obj.text.trim();
  }

  return '';
}

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function clampOutput(text: string): string {
  let output = text.trim();
  if (!output) {
    output = 'brak';
  }

  if (byteLength(output) < minOutputBytes) {
    output = output.padEnd(minOutputBytes, '.');
  }

  if (byteLength(output) <= maxOutputBytes) {
    return output;
  }

  let trimmed = output;
  while (byteLength(trimmed) > maxOutputBytes && trimmed.length > 4) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

function findByCodeOrName(parsed: { itemCode?: string; itemName?: string } | null, candidates: Item[]): Item | null {
  if (!parsed) {
    return null;
  }

  const parsedCode = typeof parsed.itemCode === 'string' ? parsed.itemCode.trim() : '';
  const byCode = parsedCode
    ? candidates.find((item) => item.code === parsedCode)
    : undefined;
  if (byCode) {
    return byCode;
  }

  if (typeof parsed.itemName === 'string' && parsed.itemName.trim()) {
    const needle = normalizeText(parsed.itemName);
    const byName = candidates.find((item) => item.normalizedName.includes(needle));
    if (byName) {
      return byName;
    }
  }

  return null;
}

function renderResult(item: Item, cities: string[]): string {
  if (cities.length === 0) {
    return `Produkt: ${item.name} (${item.code}); Miasta: brak`;
  }

  const head = `Produkt: ${item.name} (${item.code}); Miasta: `;
  let cityPart = cities.join(', ');
  let output = `${head}${cityPart}`;

  while (byteLength(output) > maxOutputBytes && cities.length > 1) {
    cities.pop();
    cityPart = `${cities.join(', ')}, ...`;
    output = `${head}${cityPart}`;
  }

  return output;
}

export function createToolService() {
  const store: DataStore = loadDataStore();
  logInfo('Loaded CSV data', {
    items: store.items.length,
    cities: store.citiesByCode.size,
    connections: store.cityCodesByItemCode.size,
  });

  async function findCityByNaturalLanguage(params: unknown): Promise<string> {
    const query = extractQuery(params);
    if (!query) {
      return clampOutput('Podaj params jako tekst zapytania o produkt.');
    }

    const candidates = findBestItems(query, store.items, 16);
    if (candidates.length === 0) {
      return clampOutput('Nie znalazłem pasującego produktu. Doprecyzuj nazwę.');
    }

    let selected = candidates[0];

    try {
      const llm = await interpretItemFromQuery(query, candidates);
      const llmSelected = findByCodeOrName(llm, candidates);
      if (llmSelected) {
        selected = llmSelected;
      }
      logInfo('Item interpretation complete', {
        query,
        selectedCode: selected.code,
      });
    } catch (error) {
      logError('LLM interpretation failed, using deterministic fallback', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const cityNames = getCityNamesForItem(selected.code, store);
    const output = clampOutput(renderResult(selected, [...cityNames]));

    logInfo('Tool response generated', {
      query,
      outputBytes: byteLength(output),
      cityCount: cityNames.length,
    });

    return output;
  }

  return {
    async handleFindCity(body: ToolRequestBody): Promise<{ output: string }> {
      const output = await findCityByNaturalLanguage(body.params);
      return { output: clampOutput(output) };
    },
  };
}
