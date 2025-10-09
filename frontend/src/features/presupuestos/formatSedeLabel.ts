const SEDE_VARIANTS: Array<{ canonical: string; variants: string[] }> = [
  {
    canonical: 'GEP Arganda',
    variants: [
      'GEP Arganda',
      'Arganda',
      'GEPArganda',
      'c/ primavera, 1, 28500, arganda del rey, madrid',
      'c primavera 1 28500 arganda del rey madrid',
      'geparganda',
    ],
  },
  {
    canonical: 'GEP Sabadell',
    variants: [
      'GEP Sabadell',
      'Sabadell',
      'GEPSabadell',
      'c/ moratín, 100, 08206 sabadell, barcelona',
      'c moratin 100 08206 sabadell barcelona',
      'gepsabadell',
    ],
  },
  {
    canonical: 'In Company',
    variants: [
      'In Company',
      'In-Company',
      'Incompany',
      'In company',
      'incompany',
      'In company - unidad móvil',
      'In company - unidad movil',
      'in company unidad movil',
    ],
  },
];

const SEDE_MAP = new Map<string, string>();

for (const entry of SEDE_VARIANTS) {
  for (const variant of entry.variants) {
    const key = normalizeKey(variant);
    if (key.length) {
      SEDE_MAP.set(key, entry.canonical);
    }
  }
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export const SEDE_OPTIONS = Array.from(new Set(SEDE_VARIANTS.map((entry) => entry.canonical)));

export function canonicalizeSedeLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const key = normalizeKey(trimmed);
  if (!key.length) return null;
  return SEDE_MAP.get(key) ?? null;
}

export function formatSedeLabel(value: string | null | undefined): string | null {
  const canonical = canonicalizeSedeLabel(value);
  if (canonical) return canonical;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
