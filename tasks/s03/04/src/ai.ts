import { aiApiKey, extraApiHeaders, negotiationsModel, responsesApiEndpoint } from './config.js';
import type { Item } from './data.js';

interface InterpretResult {
  itemCode?: string;
  itemName?: string;
}

function normalizeInterpretResult(value: unknown): InterpretResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const obj = value as { itemCode?: unknown; itemName?: unknown };
  const itemCode = typeof obj.itemCode === 'string' ? obj.itemCode.trim() : '';
  const itemName = typeof obj.itemName === 'string' ? obj.itemName.trim() : '';

  if (!itemCode && !itemName) {
    return {};
  }

  return {
    ...(itemCode ? { itemCode } : {}),
    ...(itemName ? { itemName } : {}),
  };
}

export async function interpretItemFromQuery(query: string, candidates: Item[]): Promise<InterpretResult | null> {
  if (!query.trim() || candidates.length === 0) {
    return null;
  }

  const shortlist = candidates.slice(0, 12).map((item) => ({ code: item.code, name: item.name }));

  const instructions = [
    'Jesteś parserem intencji dla narzędzia zakupowego.',
    'Masz wskazać najbardziej prawdopodobny produkt z listy kandydatów.',
    'Zwróć wyłącznie JSON bez markdown.',
    'JSON ma mieć pola opcjonalne: itemCode, itemName.',
    'Gdy nie masz pewności, zwróć pusty obiekt {}.',
  ].join(' ');

  const input = [
    {
      role: 'user',
      content: `Zapytanie: ${query}\nKandydaci: ${JSON.stringify(shortlist)}`,
    },
  ];

  const response = await fetch(responsesApiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
      ...extraApiHeaders,
    },
    body: JSON.stringify({
      model: negotiationsModel,
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'item_interpretation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              itemCode: { type: ['string', 'null'] },
              itemName: { type: ['string', 'null'] },
            },
            required: ['itemCode', 'itemName'],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 180,
    }),
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.error) {
    throw new Error(`LLM parse failed: ${response.status}`);
  }

  const text = typeof data.output_text === 'string' ? data.output_text.trim() : '';
  if (!text) {
    return null;
  }

  try {
    return normalizeInterpretResult(JSON.parse(text));
  } catch {
    return null;
  }
}
