export const FILTER_MULTI_VALUE_SEPARATOR = '||';

export function splitFilterValue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parts = String(raw)
    .split(FILTER_MULTI_VALUE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts;
}

export function joinFilterValues(values: Iterable<string>): string {
  const unique: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized.length) continue;
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique.join(FILTER_MULTI_VALUE_SEPARATOR);
}
