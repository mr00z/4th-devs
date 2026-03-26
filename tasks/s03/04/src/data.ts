import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Item {
  name: string;
  code: string;
  normalizedName: string;
}

export interface City {
  name: string;
  code: string;
}

export interface DataStore {
  items: Item[];
  citiesByCode: Map<string, City>;
  cityCodesByItemCode: Map<string, string[]>;
}

function parseCsvLine(line: string): string[] {
  return line.split(',').map((value) => value.trim());
}

function parseCsv(filePath: string): string[][] {
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function loadDataStore(rootDir: string = process.cwd()): DataStore {
  const dataDir = path.join(rootDir, 'data');
  const itemsRows = parseCsv(path.join(dataDir, 'items.csv'));
  const citiesRows = parseCsv(path.join(dataDir, 'cities.csv'));
  const connectionsRows = parseCsv(path.join(dataDir, 'connections.csv'));

  const items: Item[] = itemsRows.slice(1).map(([name, code]) => ({
    name,
    code,
    normalizedName: normalizeText(name),
  }));

  const citiesByCode = new Map<string, City>();
  for (const [name, code] of citiesRows.slice(1)) {
    citiesByCode.set(code, { name, code });
  }

  const cityCodesByItemCode = new Map<string, string[]>();
  for (const [itemCode, cityCode] of connectionsRows.slice(1)) {
    const current = cityCodesByItemCode.get(itemCode) ?? [];
    current.push(cityCode);
    cityCodesByItemCode.set(itemCode, current);
  }

  return {
    items,
    citiesByCode,
    cityCodesByItemCode,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function scoreItem(query: string, item: Item): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const queryTokens = tokenSet(normalizedQuery);
  const itemTokens = tokenSet(item.normalizedName);

  let overlap = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) {
      overlap += 1;
    }
  }

  const itemIncludesQuery = item.normalizedName.includes(normalizedQuery) ? 4 : 0;
  const queryIncludesItem = normalizedQuery.includes(item.normalizedName) ? 2 : 0;

  return overlap * 3 + itemIncludesQuery + queryIncludesItem;
}

export function findBestItems(query: string, items: Item[], limit: number = 8): Item[] {
  return [...items]
    .map((item) => ({ item, score: scoreItem(query, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function getCityNamesForItem(itemCode: string, store: DataStore): string[] {
  const cityCodes = store.cityCodesByItemCode.get(itemCode) ?? [];
  return cityCodes
    .map((cityCode) => store.citiesByCode.get(cityCode)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, 'pl'));
}
