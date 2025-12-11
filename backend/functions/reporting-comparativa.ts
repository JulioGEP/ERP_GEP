import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';

function parseDateParam(value: string | undefined, label: string): Date | { error: ReturnType<typeof errorResponse> } {
  if (!value) {
    return { error: errorResponse('INVALID_DATE', `${label} es obligatoria`, 400) };
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { error: errorResponse('INVALID_DATE', `${label} debe tener formato YYYY-MM-DD`, 400) };
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month, day));

  if (!Number.isFinite(date.getTime())) {
    return { error: errorResponse('INVALID_DATE', `${label} no es una fecha válida`, 400) };
  }

  return date;
}

function startOfISOWeek(value: Date): Date {
  const date = new Date(value);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date;
}

function getISOWeek(value: Date): number {
  const date = new Date(value);
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = thursday.getUTCDay();
  const diff = day === 0 ? -3 : 4 - day;
  thursday.setUTCDate(thursday.getUTCDate() + diff);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNumber = Math.floor((thursday.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return weekNumber;
}

function getISOWeekYear(value: Date): number {
  const date = new Date(value);
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = thursday.getUTCDay();
  const diff = day === 0 ? -3 : 4 - day;
  thursday.setUTCDate(thursday.getUTCDate() + diff);
  return thursday.getUTCFullYear();
}

function isoWeekKey(value: Date): string {
  const week = getISOWeek(value);
  const year = getISOWeekYear(value);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function buildIsoWeekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function countByIsoWeek(dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = isoWeekKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function enumerateIsoWeeks(start: Date, end: Date) {
  const weeks: Array<{ isoWeek: number; isoYear: number; label: string }> = [];
  let cursor = startOfISOWeek(start);

  while (cursor <= end) {
    const isoWeek = getISOWeek(cursor);
    const isoYear = getISOWeekYear(cursor);
    weeks.push({
      isoWeek,
      isoYear,
      label: `${isoYear}-W${String(isoWeek).padStart(2, '0')}`,
    });
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

function getProductLabel(
  name: string | null | undefined,
  code: string | null | undefined,
): string {
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName;
  const trimmedCode = code?.trim();
  if (trimmedCode) return trimmedCode;
  return 'Sin producto';
}

function buildProductRanking(
  currentItems: Array<{ productName: string | null; productCode: string | null }>,
  previousItems: Array<{ productName: string | null; productCode: string | null }>,
  category: string,
) {
  const currentCounts = new Map<string, number>();
  const previousCounts = new Map<string, number>();

  for (const item of currentItems) {
    const label = getProductLabel(item.productName, item.productCode);
    currentCounts.set(label, (currentCounts.get(label) ?? 0) + 1);
  }

  for (const item of previousItems) {
    const label = getProductLabel(item.productName, item.productCode);
    previousCounts.set(label, (previousCounts.get(label) ?? 0) + 1);
  }

  const labels = new Set<string>([...currentCounts.keys(), ...previousCounts.keys()]);

  return Array.from(labels)
    .map((label) => ({
      category,
      label,
      currentValue: currentCounts.get(label) ?? 0,
      previousValue: previousCounts.get(label) ?? 0,
    }))
    .sort((a, b) => b.currentValue - a.currentValue || a.label.localeCompare(b.label))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function getTrainerLabel(name: string | null | undefined): string {
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName;
  return 'Sin formador';
}

function normalizeTrainerEntries(
  trainers: Array<{ trainers: { name: string | null } | null }> | null | undefined,
): Array<{ trainerName: string | null }> {
  if (!trainers || trainers.length === 0) return [{ trainerName: null }];
  return trainers.map((trainer) => ({ trainerName: trainer.trainers?.name ?? null }));
}

function buildTrainerRanking(
  currentItems: Array<{ trainerName: string | null }>,
  previousItems: Array<{ trainerName: string | null }>,
  category: string,
) {
  const currentCounts = new Map<string, number>();
  const previousCounts = new Map<string, number>();

  for (const item of currentItems) {
    const label = getTrainerLabel(item.trainerName);
    currentCounts.set(label, (currentCounts.get(label) ?? 0) + 1);
  }

  for (const item of previousItems) {
    const label = getTrainerLabel(item.trainerName);
    previousCounts.set(label, (previousCounts.get(label) ?? 0) + 1);
  }

  const labels = new Set<string>([...currentCounts.keys(), ...previousCounts.keys()]);

  return Array.from(labels)
    .map((label) => ({
      category,
      label,
      currentValue: currentCounts.get(label) ?? 0,
      previousValue: previousCounts.get(label) ?? 0,
    }))
    .sort((a, b) => b.currentValue - a.currentValue || a.label.localeCompare(b.label))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

type SessionRow = {
  fecha_inicio_utc: Date | null;
  direccion: string | null;
  deals: {
    pipeline_id: string | null;
    sede_label: string | null;
    tipo_servicio: string | null;
    fundae_val: boolean | null;
    caes_val: boolean | null;
    hotel_val: boolean | null;
    comercial: string | null;
  } | null;
  deal_products: {
    name: string | null;
    code: string | null;
  } | null;
  sesion_trainers: Array<{
    trainers: {
      name: string | null;
    } | null;
  }>;
};

type VariantRow = {
  id_woo: bigint | number | string | null;
  date: Date | string | null;
  sede: string | null;
  products: {
    name: string | null;
    code: string | null;
  } | null;
  trainers: {
    name: string | null;
  } | null;
};

function normalizeVariantWooId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    const serialized = String(value).trim();
    return serialized.length ? serialized : null;
  }
  return null;
}

function normalizePipelineLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed.length) return null;
  return trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function parseCoordinate(input: string | null | undefined): { lat: number; lng: number } | null {
  if (!input) return null;
  const match = input.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;

  const first = Number.parseFloat(match[1]);
  const second = Number.parseFloat(match[2]);

  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  if (first < -90 || first > 90 || second < -180 || second > 180) return null;

  // Some sources provide the coordinates as lng,lat instead of lat,lng. Detect the swap by
  // checking whether the values make sense for Spain and flip them when the order is inverted.
  const isSpainLat = (value: number) => value >= 27 && value <= 44;
  const isSpainLng = (value: number) => value >= -19 && value <= 5;

  const looksSwapped = isSpainLng(first) && isSpainLat(second) && !isSpainLat(first);

  const lat = looksSwapped ? second : first;
  const lng = looksSwapped ? first : second;

  return { lat, lng };
}

function parseStringArrayParam(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = Array.isArray(value) ? value : String(value).split(',');
  const normalized = items
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));

  return normalized.length ? normalized : undefined;
}

function classifySession(row: SessionRow): 'gepServices' | 'formacionEmpresa' | 'formacionAbierta' | null {
  const pipeline = normalizePipelineLabel(row.deals?.pipeline_id ?? null);
  if (!pipeline) return null;
  if (pipeline === 'gep services') return 'gepServices';
  if (pipeline === 'formacion empresa' || pipeline === 'formacion empresas') return 'formacionEmpresa';
  if (pipeline === 'formacion abierta') return 'formacionAbierta';
  return null;
}

function toDateList(
  rows: Array<SessionRow | VariantRow>,
  predicate: (row: SessionRow | VariantRow) => boolean,
): Date[] {
  const dates: Date[] = [];
  for (const row of rows) {
    if (!predicate(row)) continue;
    const rawDate = 'fecha_inicio_utc' in row ? row.fecha_inicio_utc : row.date;
    if (!rawDate) continue;
    const parsed = new Date(rawDate);
    if (!Number.isFinite(parsed.getTime())) continue;
    dates.push(parsed);
  }
  return dates;
}

function buildSparkline(dates: Date[], endDate: Date, weeks: number): number[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = isoWeekKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const endWeekStart = startOfISOWeek(endDate);
  const values: number[] = [];

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const weekStart = addDays(endWeekStart, -i * 7);
    const key = isoWeekKey(weekStart);
    values.push(counts.get(key) ?? 0);
  }

  return values;
}

function computeDeltaPercentage(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  const diff = current - previous;
  return (diff / previous) * 100;
}

function mergeCounts(
  currentCounts: Map<string, number>,
  previousCounts: Map<string, number>,
  dimension: 'formacionEmpresaSite' | 'formacionAbiertaSite' | 'gepServicesType',
) {
  const labels = new Set<string>([...currentCounts.keys(), ...previousCounts.keys()]);
  return Array.from(labels)
    .map((label) => ({
      dimension,
      label,
      current: currentCounts.get(label) ?? 0,
      previous: previousCounts.get(label) ?? 0,
    }))
    .sort((a, b) => b.current - a.current || a.label.localeCompare(b.label));
}

export const handler = createHttpHandler(async (request) => {
  if (request.method === 'OPTIONS') {
    return successResponse();
  }

  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const currentStart = parseDateParam(request.query.currentStartDate, 'Fecha inicio');
  if ('error' in currentStart) return currentStart.error;
  const currentEnd = parseDateParam(request.query.currentEndDate, 'Fecha fin');
  if ('error' in currentEnd) return currentEnd.error;
  const previousStart = parseDateParam(request.query.previousStartDate, 'Fecha inicio comparativa');
  if ('error' in previousStart) return previousStart.error;
  const previousEnd = parseDateParam(request.query.previousEndDate, 'Fecha fin comparativa');
  if ('error' in previousEnd) return previousEnd.error;

  const currentEndExclusive = addDays(currentEnd, 1);
  const previousEndExclusive = addDays(previousEnd, 1);

  const siteFilters =
    parseStringArrayParam(request.query.siteId ?? request.query.siteIds) ??
    parseStringArrayParam(request.event.multiValueQueryStringParameters?.siteId);
  const trainingTypes =
    parseStringArrayParam(request.query.trainingType ?? request.query.trainingTypes) ??
    parseStringArrayParam(request.event.multiValueQueryStringParameters?.trainingType);
  const comerciales =
    parseStringArrayParam(request.query.comercial ?? request.query.comerciales ?? request.query.costCenterId) ??
    parseStringArrayParam(
      request.event.multiValueQueryStringParameters?.comercial ??
        request.event.multiValueQueryStringParameters?.comerciales ??
        request.event.multiValueQueryStringParameters?.costCenterId,
    );

  const [
    currentSessions,
    previousSessions,
    currentVariants,
    previousVariants,
    currentVariantDeals,
    previousVariantDeals,
  ] = await Promise.all([
    prisma.sesiones.findMany({
      where: {
        fecha_inicio_utc: { gte: currentStart, lt: currentEndExclusive },
        deals: {
          ...(siteFilters ? { sede_label: { in: siteFilters } } : {}),
          ...(trainingTypes ? { pipeline_id: { in: trainingTypes } } : {}),
          ...(comerciales ? { comercial: { in: comerciales } } : {}),
        },
      },
      select: {
        fecha_inicio_utc: true,
        direccion: true,
        deals: {
          select: {
            pipeline_id: true,
            sede_label: true,
            tipo_servicio: true,
            fundae_val: true,
            caes_val: true,
            hotel_val: true,
            comercial: true,
          },
        },
        deal_products: { select: { name: true, code: true } },
        sesion_trainers: {
          select: {
            trainers: { select: { name: true } },
          },
        },
      },
    }) as Promise<SessionRow[]>,
    prisma.sesiones.findMany({
      where: {
        fecha_inicio_utc: { gte: previousStart, lt: previousEndExclusive },
        deals: {
          ...(siteFilters ? { sede_label: { in: siteFilters } } : {}),
          ...(trainingTypes ? { pipeline_id: { in: trainingTypes } } : {}),
          ...(comerciales ? { comercial: { in: comerciales } } : {}),
        },
      },
      select: {
        fecha_inicio_utc: true,
        direccion: true,
        deals: {
          select: {
            pipeline_id: true,
            sede_label: true,
            tipo_servicio: true,
            fundae_val: true,
            caes_val: true,
            hotel_val: true,
            comercial: true,
          },
        },
        deal_products: { select: { name: true, code: true } },
        sesion_trainers: {
          select: {
            trainers: { select: { name: true } },
          },
        },
      },
    }) as Promise<SessionRow[]>,
    prisma.variants.findMany({
      where: {
        date: { gte: currentStart, lt: currentEndExclusive },
        ...(siteFilters ? { sede: { in: siteFilters } } : {}),
      },
      select: {
        id_woo: true,
        date: true,
        sede: true,
        products: { select: { name: true, code: true } },
        trainers: { select: { name: true } },
      },
    }) as Promise<VariantRow[]>,
    prisma.variants.findMany({
      where: {
        date: { gte: previousStart, lt: previousEndExclusive },
        ...(siteFilters ? { sede: { in: siteFilters } } : {}),
      },
      select: {
        id_woo: true,
        date: true,
        sede: true,
        products: { select: { name: true, code: true } },
        trainers: { select: { name: true } },
      },
    }) as Promise<VariantRow[]>,
    prisma.deals.findMany({
      where: {
        w_id_variation: { not: null },
        a_fecha: { gte: currentStart, lt: currentEndExclusive },
        ...(siteFilters ? { sede_label: { in: siteFilters } } : {}),
        ...(trainingTypes ? { pipeline_id: { in: trainingTypes } } : {}),
        ...(comerciales ? { comercial: { in: comerciales } } : {}),
      },
      select: { w_id_variation: true },
    }),
    prisma.deals.findMany({
      where: {
        w_id_variation: { not: null },
        a_fecha: { gte: previousStart, lt: previousEndExclusive },
        ...(siteFilters ? { sede_label: { in: siteFilters } } : {}),
        ...(trainingTypes ? { pipeline_id: { in: trainingTypes } } : {}),
        ...(comerciales ? { comercial: { in: comerciales } } : {}),
      },
      select: { w_id_variation: true },
    }),
  ]);

  const currentVariantDealIds = new Set(
    (currentVariantDeals as Array<{ w_id_variation: unknown }> )
      .map((deal) => normalizeVariantWooId(deal.w_id_variation))
      .filter((value): value is string => Boolean(value)),
  );

  const previousVariantDealIds = new Set(
    (previousVariantDeals as Array<{ w_id_variation: unknown }>)
      .map((deal) => normalizeVariantWooId(deal.w_id_variation))
      .filter((value): value is string => Boolean(value)),
  );

  const filteredCurrentVariants = currentVariants.filter((variant) => {
    const normalizedIdWoo = normalizeVariantWooId(variant.id_woo);
    return normalizedIdWoo ? currentVariantDealIds.has(normalizedIdWoo) : false;
  });

  const filteredPreviousVariants = previousVariants.filter((variant) => {
    const normalizedIdWoo = normalizeVariantWooId(variant.id_woo);
    return normalizedIdWoo ? previousVariantDealIds.has(normalizedIdWoo) : false;
  });

  const heatmap = (() => {
    const counts = new Map<string, { lat: number; lng: number; address: string; total: number }>();

    for (const session of currentSessions) {
      const coords = parseCoordinate(session.direccion);
      if (!coords) continue;
      const key = `${coords.lat.toFixed(5)}|${coords.lng.toFixed(5)}`;
      const current = counts.get(key);
      counts.set(key, {
        lat: coords.lat,
        lng: coords.lng,
        address: session.direccion ?? '',
        total: (current?.total ?? 0) + 1,
      });
    }

    return Array.from(counts.values()).map((item) => ({
      latitude: item.lat,
      longitude: item.lng,
      address: item.address,
      sessions: item.total,
    }));
  })();

  const weeks = 12;

  const gepCurrentDates = toDateList(currentSessions, (row) => classifySession(row as SessionRow) === 'gepServices');
  const gepPreviousDates = toDateList(previousSessions, (row) => classifySession(row as SessionRow) === 'gepServices');
  const gepPrevious = gepPreviousDates.length;

  const formacionEmpresaCurrentDates = toDateList(
    currentSessions,
    (row) => classifySession(row as SessionRow) === 'formacionEmpresa',
  );
  const formacionEmpresaPreviousDates = toDateList(
    previousSessions,
    (row) => classifySession(row as SessionRow) === 'formacionEmpresa',
  );
  const formacionEmpresaPrevious = formacionEmpresaPreviousDates.length;

  const formacionAbiertaCurrentDates = [
    ...toDateList(currentSessions, (row) => classifySession(row as SessionRow) === 'formacionAbierta'),
    ...toDateList(filteredCurrentVariants, () => true),
  ];
  const formacionAbiertaPrevious =
    toDateList(previousSessions, (row) => classifySession(row as SessionRow) === 'formacionAbierta').length +
    toDateList(filteredPreviousVariants, () => true).length;

  const toBoolean = (value: boolean | null | undefined) => Boolean(value);

  const formacionEmpresaSessions = currentSessions.filter((session) => classifySession(session) === 'formacionEmpresa');
  const gepServicesSessions = currentSessions.filter((session) => classifySession(session) === 'gepServices');

  const binaryMixes = {
    formacionEmpresaFundae: {
      yes: formacionEmpresaSessions.filter((session) => toBoolean(session.deals?.fundae_val)).length,
      no: formacionEmpresaSessions.filter((session) => !toBoolean(session.deals?.fundae_val)).length,
    },
    formacionEmpresaCaes: {
      yes: formacionEmpresaSessions.filter((session) => toBoolean(session.deals?.caes_val)).length,
      no: formacionEmpresaSessions.filter((session) => !toBoolean(session.deals?.caes_val)).length,
    },
    formacionEmpresaHotel: {
      yes: formacionEmpresaSessions.filter((session) => toBoolean(session.deals?.hotel_val)).length,
      no: formacionEmpresaSessions.filter((session) => !toBoolean(session.deals?.hotel_val)).length,
    },
    gepServicesCaes: {
      yes: gepServicesSessions.filter((session) => toBoolean(session.deals?.caes_val)).length,
      no: gepServicesSessions.filter((session) => !toBoolean(session.deals?.caes_val)).length,
    },
  } as const;

  const weeklyWindow = enumerateIsoWeeks(currentStart, currentEnd);
  const previousWeeklyWindow = enumerateIsoWeeks(previousStart, previousEnd);

  const gepCurrentCounts = countByIsoWeek(gepCurrentDates);
  const gepPreviousCounts = countByIsoWeek(gepPreviousDates);

  const formacionEmpresaCurrentCounts = countByIsoWeek(formacionEmpresaCurrentDates);
  const formacionEmpresaPreviousCounts = countByIsoWeek(formacionEmpresaPreviousDates);

  const formacionEmpresaSiteCurrentCounts = new Map<string, number>();
  const formacionEmpresaSitePreviousCounts = new Map<string, number>();

  for (const session of currentSessions) {
    if (classifySession(session) !== 'formacionEmpresa') continue;
    const site = session.deals?.sede_label?.trim() || 'Sin sede';
    formacionEmpresaSiteCurrentCounts.set(site, (formacionEmpresaSiteCurrentCounts.get(site) ?? 0) + 1);
  }

  for (const session of previousSessions) {
    if (classifySession(session) !== 'formacionEmpresa') continue;
    const site = session.deals?.sede_label?.trim() || 'Sin sede';
    formacionEmpresaSitePreviousCounts.set(site, (formacionEmpresaSitePreviousCounts.get(site) ?? 0) + 1);
  }

  const formacionAbiertaSiteCurrentCounts = new Map<string, number>();
  const formacionAbiertaSitePreviousCounts = new Map<string, number>();

  for (const variant of filteredCurrentVariants) {
    const site = (variant.sede ?? '').trim() || 'Sin sede';
    formacionAbiertaSiteCurrentCounts.set(site, (formacionAbiertaSiteCurrentCounts.get(site) ?? 0) + 1);
  }

  for (const variant of filteredPreviousVariants) {
    const site = (variant.sede ?? '').trim() || 'Sin sede';
    formacionAbiertaSitePreviousCounts.set(site, (formacionAbiertaSitePreviousCounts.get(site) ?? 0) + 1);
  }

  const gepServicesTypeCurrentCounts = new Map<string, number>();
  const gepServicesTypePreviousCounts = new Map<string, number>();

  for (const session of currentSessions) {
    if (classifySession(session) !== 'gepServices') continue;
    const type = session.deals?.tipo_servicio?.trim() || 'Sin tipo de servicio';
    gepServicesTypeCurrentCounts.set(type, (gepServicesTypeCurrentCounts.get(type) ?? 0) + 1);
  }

  for (const session of previousSessions) {
    if (classifySession(session) !== 'gepServices') continue;
    const type = session.deals?.tipo_servicio?.trim() || 'Sin tipo de servicio';
    gepServicesTypePreviousCounts.set(type, (gepServicesTypePreviousCounts.get(type) ?? 0) + 1);
  }

  const buildWeeklyTrend = (
    label: string,
    metric: 'formacionEmpresaSessions' | 'gepServicesSessions',
    currentCounts: Map<string, number>,
    previousCounts: Map<string, number>,
  ) => ({
    metric,
    label,
    points: weeklyWindow.map((week, index) => {
      const previousWeek = previousWeeklyWindow[index];

      return {
        periodLabel: week.label,
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        currentValue: currentCounts.get(buildIsoWeekKey(week.isoYear, week.isoWeek)) ?? 0,
        previousValue: previousWeek
          ? previousCounts.get(buildIsoWeekKey(previousWeek.isoYear, previousWeek.isoWeek)) ?? 0
          : 0,
      };
    }),
  });

  const trends = [
    buildWeeklyTrend('Formación Empresa vs comparativa', 'formacionEmpresaSessions', formacionEmpresaCurrentCounts, formacionEmpresaPreviousCounts),
    buildWeeklyTrend('GEP Services vs comparativa', 'gepServicesSessions', gepCurrentCounts, gepPreviousCounts),
  ];

  const formacionEmpresaCurrentProducts = currentSessions
    .filter((session) => classifySession(session) === 'formacionEmpresa')
    .map((session) => ({ productName: session.deal_products?.name ?? null, productCode: session.deal_products?.code ?? null }));

  const formacionEmpresaPreviousProducts = previousSessions
    .filter((session) => classifySession(session) === 'formacionEmpresa')
    .map((session) => ({ productName: session.deal_products?.name ?? null, productCode: session.deal_products?.code ?? null }));

  const gepServicesCurrentProducts = currentSessions
    .filter((session) => classifySession(session) === 'gepServices')
    .map((session) => ({ productName: session.deal_products?.name ?? null, productCode: session.deal_products?.code ?? null }));

  const gepServicesPreviousProducts = previousSessions
    .filter((session) => classifySession(session) === 'gepServices')
    .map((session) => ({ productName: session.deal_products?.name ?? null, productCode: session.deal_products?.code ?? null }));

  const formacionAbiertaCurrentProducts = [
    ...currentSessions
      .filter((session) => classifySession(session) === 'formacionAbierta')
      .map((session) => ({ productName: session.deal_products?.name ?? null, productCode: session.deal_products?.code ?? null })),
    ...filteredCurrentVariants.map((variant) => ({
      productName: variant.products?.name ?? null,
      productCode: variant.products?.code ?? null,
    })),
  ];

  const formacionAbiertaPreviousProducts = [
    ...previousSessions
      .filter((session) => classifySession(session) === 'formacionAbierta')
      .map((session) => ({ productName: session.deal_products?.name ?? null, productCode: session.deal_products?.code ?? null })),
    ...filteredPreviousVariants.map((variant) => ({
      productName: variant.products?.name ?? null,
      productCode: variant.products?.code ?? null,
    })),
  ];

  const formacionEmpresaCurrentTrainers = currentSessions
    .filter((session) => classifySession(session) === 'formacionEmpresa')
    .flatMap((session) => normalizeTrainerEntries(session.sesion_trainers));

  const formacionEmpresaPreviousTrainers = previousSessions
    .filter((session) => classifySession(session) === 'formacionEmpresa')
    .flatMap((session) => normalizeTrainerEntries(session.sesion_trainers));

  const gepServicesCurrentTrainers = currentSessions
    .filter((session) => classifySession(session) === 'gepServices')
    .flatMap((session) => normalizeTrainerEntries(session.sesion_trainers));

  const gepServicesPreviousTrainers = previousSessions
    .filter((session) => classifySession(session) === 'gepServices')
    .flatMap((session) => normalizeTrainerEntries(session.sesion_trainers));

  const formacionAbiertaCurrentTrainers = [
    ...currentSessions
      .filter((session) => classifySession(session) === 'formacionAbierta')
      .flatMap((session) => normalizeTrainerEntries(session.sesion_trainers)),
    ...filteredCurrentVariants.map((variant) => ({ trainerName: variant.trainers?.name ?? null })),
  ];

  const formacionAbiertaPreviousTrainers = [
    ...previousSessions
      .filter((session) => classifySession(session) === 'formacionAbierta')
      .flatMap((session) => normalizeTrainerEntries(session.sesion_trainers)),
    ...filteredPreviousVariants.map((variant) => ({ trainerName: variant.trainers?.name ?? null })),
  ];

  const ranking = [
    ...buildProductRanking(formacionEmpresaCurrentProducts, formacionEmpresaPreviousProducts, 'formacionEmpresa'),
    ...buildProductRanking(gepServicesCurrentProducts, gepServicesPreviousProducts, 'gepServices'),
    ...buildProductRanking(formacionAbiertaCurrentProducts, formacionAbiertaPreviousProducts, 'formacionAbierta'),
    ...buildTrainerRanking(formacionEmpresaCurrentTrainers, formacionEmpresaPreviousTrainers, 'formacionEmpresaTrainers'),
    ...buildTrainerRanking(gepServicesCurrentTrainers, gepServicesPreviousTrainers, 'gepServicesTrainers'),
    ...buildTrainerRanking(formacionAbiertaCurrentTrainers, formacionAbiertaPreviousTrainers, 'formacionAbiertaTrainers'),
  ];

  const highlights = [
    {
      key: 'gepServicesSessions',
      label: 'GEP Services',
      unit: 'number' as const,
      value: gepCurrentDates.length,
      lastYearValue: gepPrevious,
      deltaPercentage: computeDeltaPercentage(gepCurrentDates.length, gepPrevious),
      sparkline: buildSparkline(gepCurrentDates, currentEnd, weeks),
    },
    {
      key: 'formacionEmpresaSessions',
      label: 'Formacion Empresa',
      unit: 'number' as const,
      value: formacionEmpresaCurrentDates.length,
      lastYearValue: formacionEmpresaPrevious,
      deltaPercentage: computeDeltaPercentage(
        formacionEmpresaCurrentDates.length,
        formacionEmpresaPrevious,
      ),
      sparkline: buildSparkline(formacionEmpresaCurrentDates, currentEnd, weeks),
    },
    {
      key: 'formacionAbiertaVariantesSessions',
      label: 'Formación Abierta',
      unit: 'number' as const,
      value: formacionAbiertaCurrentDates.length,
      lastYearValue: formacionAbiertaPrevious,
      deltaPercentage: computeDeltaPercentage(
        formacionAbiertaCurrentDates.length,
        formacionAbiertaPrevious,
      ),
      sparkline: buildSparkline(formacionAbiertaCurrentDates, currentEnd, weeks),
    },
  ];

  const [dealSites, variantSites, pipelineOptions, comercialOptions]: [
    { sede_label: string | null }[],
    { sede: string | null }[],
    { pipeline_id: string | null }[],
    { comercial: string | null }[],
  ] = await Promise.all([
    prisma.deals.findMany({ distinct: ['sede_label'], select: { sede_label: true } }),
    prisma.variants.findMany({ distinct: ['sede'], select: { sede: true } }),
    prisma.deals.findMany({ distinct: ['pipeline_id'], select: { pipeline_id: true } }),
    prisma.deals.findMany({ distinct: ['comercial'], select: { comercial: true } }),
  ]);

  const siteOptionSet = new Set<string>();
  for (const item of dealSites) {
    const label = item.sede_label?.trim();
    if (label) siteOptionSet.add(label);
  }
  for (const item of variantSites) {
    const label = item.sede?.trim();
    if (label) siteOptionSet.add(label);
  }

  const filterOptions = {
    sites: Array.from(siteOptionSet).sort((a, b) => a.localeCompare(b)),
    trainingTypes: pipelineOptions
      .map((item) => item.pipeline_id?.trim())
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b)),
    comerciales: comercialOptions
      .map((item) => item.comercial?.trim())
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b)),
  } as const;

  return successResponse({
    highlights,
    trends,
    breakdowns: [
      ...mergeCounts(formacionEmpresaSiteCurrentCounts, formacionEmpresaSitePreviousCounts, 'formacionEmpresaSite'),
      ...mergeCounts(formacionAbiertaSiteCurrentCounts, formacionAbiertaSitePreviousCounts, 'formacionAbiertaSite'),
      ...mergeCounts(gepServicesTypeCurrentCounts, gepServicesTypePreviousCounts, 'gepServicesType'),
    ],
    revenueMix: [],
    binaryMixes: [
      {
        key: 'formacionEmpresaFundae',
        label: 'Formación Empresa · FUNDAE',
        yes: binaryMixes.formacionEmpresaFundae.yes,
        no: binaryMixes.formacionEmpresaFundae.no,
      },
      {
        key: 'formacionEmpresaCaes',
        label: 'Formación Empresa · CAES',
        yes: binaryMixes.formacionEmpresaCaes.yes,
        no: binaryMixes.formacionEmpresaCaes.no,
      },
      {
        key: 'formacionEmpresaHotel',
        label: 'Formación Empresa · Hotel',
        yes: binaryMixes.formacionEmpresaHotel.yes,
        no: binaryMixes.formacionEmpresaHotel.no,
      },
      {
        key: 'gepServicesCaes',
        label: 'GEP Services · CAES',
        yes: binaryMixes.gepServicesCaes.yes,
        no: binaryMixes.gepServicesCaes.no,
      },
    ],
    heatmap,
    funnel: [],
    ranking,
    filterOptions,
  });
});

