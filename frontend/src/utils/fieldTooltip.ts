export function buildFieldTooltip(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const stringValue = typeof value === 'string' ? value : String(value);
  const normalized = stringValue.trim();
  return normalized.length ? stringValue : undefined;
}
