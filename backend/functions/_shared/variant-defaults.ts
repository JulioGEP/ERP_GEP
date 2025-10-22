const DB_STATUS_MAP = new Map<string, string>([
  ['sin valor', 'Sin valor'],
  ['en stock', 'En stock'],
  ['sin stock', 'Sin stock'],
  ['reservar por adelantado', 'Reservar por adelantado'],
]);

const API_TO_DB_STATUS = new Map<string, string>([
  ['instock', 'En stock'],
  ['outofstock', 'Sin stock'],
  ['onbackorder', 'Reservar por adelantado'],
  ['', 'Sin valor'],
]);

const DB_TO_API_STATUS = new Map<string, string>([
  ['en stock', 'instock'],
  ['sin stock', 'outofstock'],
  ['reservar por adelantado', 'onbackorder'],
  ['instock', 'instock'],
  ['outofstock', 'outofstock'],
  ['onbackorder', 'onbackorder'],
]);

export function mapApiStockStatusToDbValue(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return 'Sin valor';
  }

  const lookupKey = normalized.toLowerCase();

  if (API_TO_DB_STATUS.has(lookupKey)) {
    return API_TO_DB_STATUS.get(lookupKey)!;
  }

  if (DB_STATUS_MAP.has(lookupKey)) {
    return DB_STATUS_MAP.get(lookupKey)!;
  }

  throw new Error('INVALID_STOCK_STATUS');
}

export function mapDbStockStatusToApiValue(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const lookupKey = normalized.toLowerCase();

  if (lookupKey === 'sin valor') {
    return null;
  }

  if (DB_TO_API_STATUS.has(lookupKey)) {
    return DB_TO_API_STATUS.get(lookupKey)!;
  }

  return null;
}

export function getWooStockStatusFromDb(value: string | null | undefined): 'instock' | 'outofstock' | 'onbackorder' {
  const apiValue = mapDbStockStatusToApiValue(value);
  if (apiValue === 'outofstock' || apiValue === 'onbackorder') {
    return apiValue;
  }
  return 'instock';
}
