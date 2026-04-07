import { food4cities } from '../food4cities.js'
import type { NormalizedOrder, ValidationIssue, ValidationResult } from '../types.js'

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function extractItemsMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') {
    return {}
  }

  if (Array.isArray(value)) {
    const result: Record<string, number> = {}
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const name = typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : null
      const qty = coerceNumber(
        (entry as { items?: unknown; quantity?: unknown; amount?: unknown }).items
        ?? (entry as { quantity?: unknown }).quantity
        ?? (entry as { amount?: unknown }).amount,
      )
      if (name && qty !== null) {
        result[name] = qty
      }
    }
    return result
  }

  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const qty = coerceNumber(raw)
    if (qty !== null) {
      result[key] = qty
    }
  }
  return result
}

function extractOrdersArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw
  }
  if (!raw || typeof raw !== 'object') {
    return []
  }
  const object = raw as Record<string, unknown>
  for (const key of ['orders', 'data', 'result']) {
    if (Array.isArray(object[key])) {
      return object[key] as unknown[]
    }
  }
  if (object.order && typeof object.order === 'object') {
    return [object.order]
  }
  return []
}

export function normalizeOrders(raw: unknown): NormalizedOrder[] {
  return extractOrdersArray(raw).map((entry, index) => {
    const object = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const idValue = object.id ?? object.orderId ?? object.uuid ?? `order-${index + 1}`
    const titleValue = object.title ?? object.name ?? object.orderTitle ?? `Order ${index + 1}`
    const destinationValue = object.destination ?? object.destinationCode
    const destination = typeof destinationValue === 'string' || typeof destinationValue === 'number'
      ? destinationValue
      : null
    return {
      id: String(idValue),
      title: String(titleValue),
      creatorID: coerceNumber(object.creatorID ?? object.creatorId ?? object.userId),
      destination,
      items: extractItemsMap(object.items ?? object.products ?? object.goods),
      raw: entry,
    }
  })
}

export function cityFromOrderTitle(title: string): string | null {
  const normalizedTitle = normalizeKey(title)
  for (const city of Object.keys(food4cities)) {
    if (normalizedTitle.includes(normalizeKey(city))) {
      return city
    }
  }
  return null
}

export function validateOrders(orders: NormalizedOrder[]): ValidationResult {
  const expectedCities = Object.keys(food4cities)
  const issues: ValidationIssue[] = []
  const cityBuckets = new Map<string, NormalizedOrder[]>()

  for (const order of orders) {
    const city = cityFromOrderTitle(order.title)
    if (!city) {
      issues.push({
        type: 'unknown_order',
        orderId: order.id,
        message: `Order "${order.title}" does not map to any expected city title.`,
      })
      continue
    }
    const bucket = cityBuckets.get(city) ?? []
    bucket.push(order)
    cityBuckets.set(city, bucket)
  }

  for (const city of expectedCities) {
    const mapped = cityBuckets.get(city) ?? []
    if (mapped.length === 0) {
      issues.push({
        type: 'missing_city',
        city,
        message: `Missing order for city "${city}".`,
      })
      continue
    }
    if (mapped.length > 1) {
      issues.push({
        type: 'duplicate_city',
        city,
        message: `Expected one order for city "${city}", found ${mapped.length}.`,
      })
      continue
    }

    const order = mapped[0]
    const expectedItems = food4cities[city as keyof typeof food4cities]
    const actualItems = order.items

    for (const [item, expectedQty] of Object.entries(expectedItems)) {
      if (!(item in actualItems)) {
        issues.push({
          type: 'missing_item',
          city,
          orderId: order.id,
          item,
          expected: expectedQty,
          message: `Order for "${city}" is missing item "${item}".`,
        })
        continue
      }
      if (actualItems[item] !== expectedQty) {
        issues.push({
          type: 'wrong_quantity',
          city,
          orderId: order.id,
          item,
          expected: expectedQty,
          actual: actualItems[item],
          message: `Order for "${city}" has wrong quantity for "${item}". Expected ${expectedQty}, got ${actualItems[item]}.`,
        })
      }
    }

    for (const [item, actualQty] of Object.entries(actualItems)) {
      if (!(item in expectedItems)) {
        issues.push({
          type: 'extra_item',
          city,
          orderId: order.id,
          item,
          actual: actualQty,
          message: `Order for "${city}" contains unexpected item "${item}".`,
        })
      }
    }
  }

  return {
    ok: issues.length === 0,
    expectedCityCount: expectedCities.length,
    actualOrderCount: orders.length,
    coveredCities: [...cityBuckets.keys()].sort(),
    issues,
  }
}

export function isSafeDatabaseQuery(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) {
    return false
  }
  if (trimmed.includes(';')) {
    return false
  }
  return /^(select\s+.+|show\s+tables|show\s+create\s+table\s+\w+|\.tables|\.schema(?:\s+\w+)?|pragma\s+table_info\s*\(\s*\w+\s*\))$/i.test(trimmed)
}
