const SEDE_ALIASES: Record<string, string> = {
  'c/ moratín, 100, 08206 sabadell, barcelona': 'GEP Sabadell',
  'c/ primavera, 1, 28500, arganda del rey, madrid': 'GEP Arganda',
  'in company': 'In Company',
  'in company - unidad movil': 'In Company',
  'in company - unidad móvil': 'In Company',
  'in company - unidades_moviles móvil': 'In Company'
};

export function formatSedeLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const alias = SEDE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}
