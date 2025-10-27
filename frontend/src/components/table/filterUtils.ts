import type { FilterOption } from './FilterToolbar';

export function buildFilterOptions(values: Iterable<string>): FilterOption[] {
  const unique = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (value.length) {
      unique.add(value);
    }
  }
  const sorted = Array.from(unique).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  return sorted.map((value) => ({ value, label: value }));
}
