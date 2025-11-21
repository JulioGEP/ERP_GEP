// backend/functions/calendar-variants.ts
import { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { ensureMadridTimezone, toMadridISOString } from './_shared/timezone';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import {
  ensureCors,
  errorResponse,
  preflightResponse,
  successResponse,
} from './_shared/response';
import { isVariantResourceColumnError, setVariantResourceColumnsSupport } from './_shared/variant-resources';

/** ====== Tipos de respuesta ====== */
type CalendarVariantDeal = {
  id: string | null;
  title: string | null;
  pipeline_id: string | null;
  training_address: string | null;
  sede_label: string | null;
  caes_label: string | null;
  fundae_label: string | null;
  hotel_label: string | null;
  transporte: string | null;
};

type CalendarVariantEvent = {
  id: string;
  start: string;
  end: string;
  product: {
    id: string;
    id_woo: string | null;
    name: string | null;
    code: string | null;
    category: string | null;
    hora_inicio: string | null;
    hora_fin: string | null;
    variant_start: string | null;
    variant_end: string | null;
    variant_stock_status: string | null;
    variant_stock_quantity: number | null;
    variant_price: string | null;
  };
  variant: {
    id: string;
    id_woo: string | null;
    name: string | null;
    status: string | null;
    price: string | null;
    stock: number | null;
    stock_status: string | null;
    sede: string | null;
    date: string | null;
    trainer_id: string | null;
    trainer: { trainer_id: string | null; name: string | null; apellido: string | null } | null;
    sala_id: string | null;
    sala: { sala_id: string | null; name: string | null; sede: string | null } | null;
    unidad_movil_id: string | null;
    unidad: { unidad_id: string | null; name: string | null; matricula: string | null } | null;
    students_total: number | null;
    created_at: string | null;
    updated_at: string | null;
  };
  deals: CalendarVariantDeal[];
};

/** ====== Tipo exacto de cada fila devuelta por deals.findMany (select usado abajo) ====== */
type DealRow = {
  w_id_variation: string | number | null;

  deal_id: string | null;
  title: string | null;
  pipeline_id: string | null;
  training_address: string | null;
  sede_label: string | null;
  caes_label: string | null;
  fundae_label: string | null;
  hotel_label: string | null;
  transporte: string | null;

  _count: { alumnos: number };
};

type DateRange = { start: Date; end: Date };

/** ====== Utils de parsing ====== */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

/** Lee el primer parámetro disponible entre varios nombres posibles */
function getFirstParam(qs: Record<string, any> | undefined, names: string[]): string | null {
  if (!qs) return null;
  for (const n of names) {
    if (qs[n] !== undefined && qs[n] !== null) return String(qs[n]);
  }
  return null;
}

/** Acepta ISO o YYYY-MM-DD; null si inválida */
function parseDateFlex(raw: unknown): Date | null {
  const text = toTrimmed(raw);
  if (!text) return null;
  const d = new Date(text);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ensureValidRange(start: Date | null, end: Date | null): DateRange | null {
  if (!start || !end) return null;
  if (end.getTime() < start.getTime()) return null;
  return { start, end };
}

type TimeParts = { hour: number; minute: number };

function parseHHMM(value: string | null | undefined): TimeParts | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

/** ====== Normalizadores ====== */
function normalizeVariantRecord(
  record: {
    id: string;
    id_woo: number | bigint | string;
    name: string | null;
    status: string | null;
    price: number | string | null;
    stock: number | null;
    stock_status: string | null;
    sede: string | null;
    date: Date | null;
    trainer_id?: string | null;
    sala_id?: string | null;
    unidad_movil_id?: string | null;
    trainers?: { trainer_id: string | null; name: string | null; apellido: string | null } | null;
    salas?: { sala_id: string | null; name: string | null; sede: string | null } | null;
    unidades_moviles?: { unidad_id: string | null; name: string | null; matricula: string | null } | null;
    created_at: Date | null;
    updated_at: Date | null;
  },
  studentsTotal?: number | null,
) {
  const normalizedStudentsTotal =
    typeof studentsTotal === 'number' && Number.isFinite(studentsTotal) ? studentsTotal : null;

  const trainerRecord = record.trainers ?? null;
  const salaRecord = record.salas ?? null;
  const unidadRecord = record.unidades_moviles ?? null;

  return {
    id: record.id,
    id_woo: record.id_woo != null ? record.id_woo.toString() : null,
    name: record.name ?? null,
    status: record.status ?? null,
    price:
      record.price == null
        ? null
        : typeof record.price === 'string'
          ? record.price
          : record.price.toString(),
    stock: record.stock ?? null,
    stock_status: record.stock_status ?? null,
    sede: record.sede ?? null,
    date: toMadridISOString(record.date),
    trainer_id: record.trainer_id ?? null,
    trainer: trainerRecord
      ? {
          trainer_id: trainerRecord.trainer_id ?? null,
          name: trainerRecord.name ?? null,
          apellido: trainerRecord.apellido ?? null,
        }
      : null,
    sala_id: record.sala_id ?? null,
    sala: salaRecord
      ? {
          sala_id: salaRecord.sala_id ?? null,
          name: salaRecord.name ?? null,
          sede: salaRecord.sede ?? null,
        }
      : null,
    unidad_movil_id: record.unidad_movil_id ?? null,
    unidad: unidadRecord
      ? {
          unidad_id: unidadRecord.unidad_id ?? null,
          name: unidadRecord.name ?? null,
          matricula: unidadRecord.matricula ?? null,
        }
      : null,
    students_total: normalizedStudentsTotal,
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  };
}

function normalizeProductRecord(record: {
  id: string;
  id_woo: number | bigint | string;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: Date | string | null;
  hora_fin: Date | string | null;
  variant_start: Date | null;
  variant_end: Date | null;
  variant_stock_status: string | null;
  variant_stock_quantity: number | null;
  variant_price: string | number | null;
}) {
  return {
    id: record.id,
    id_woo: record.id_woo != null ? record.id_woo.toString() : null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
    variant_start: toMadridISOString(record.variant_start),
    variant_end: toMadridISOString(record.variant_end),
    variant_stock_status: record.variant_stock_status ?? null,
    variant_stock_quantity: record.variant_stock_quantity ?? null,
    variant_price:
      record.variant_price == null
        ? null
        : typeof record.variant_price === 'string'
          ? record.variant_price
          : record.variant_price.toString(),
  };
}

function computeEventTimes(
  variantDate: Date | null,
  product: { hora_inicio: string | null; hora_fin: string | null },
) {
  if (!variantDate) return null;

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const startTime = parseHHMM(product.hora_inicio);
  const endTime = parseHHMM(product.hora_fin);
  const fallbackStart: TimeParts = { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startTime, fallbackStart);
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

function normalizeProductIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
  return normalized.length ? normalized : null;
}

const TWO_DAY_VERTICAL_PRODUCT_KEYS = new Set(['atrabajosverticales', 'trabajosverticales']);

function isTwoDayVerticalProduct(product: {
  name: string | null;
  code: string | null;
  category: string | null;
}): boolean {
  const identifiers = [product.name, product.code, product.category]
    .map((value) => normalizeProductIdentifier(value))
    .filter((value): value is string => Boolean(value));

  return identifiers.some((identifier) => TWO_DAY_VERTICAL_PRODUCT_KEYS.has(identifier));
}

function sanitizeVariantDeal(record: {
  deal_id: string | null;
  title: string | null;
  pipeline_id: string | null;
  training_address: string | null;
  sede_label: string | null;
  caes_label: string | null;
  fundae_label: string | null;
  hotel_label: string | null;
  transporte: string | null;
}): CalendarVariantDeal | null {
  const id = toTrimmed(record.deal_id);
  const title = toTrimmed(record.title);
  const pipelineId = toTrimmed(record.pipeline_id);
  const trainingAddress = toTrimmed(record.training_address);
  const sedeLabel = toTrimmed(record.sede_label);
  const caesLabel = toTrimmed(record.caes_label);
  const fundaeLabel = toTrimmed(record.fundae_label);
  const hotelLabel = toTrimmed(record.hotel_label);
  const transporte = toTrimmed(record.transporte);

  if (
    !id &&
    !title &&
    !pipelineId &&
    !trainingAddress &&
    !sedeLabel &&
    !caesLabel &&
    !fundaeLabel &&
    !hotelLabel &&
    !transporte
  ) {
    return null;
  }

  return {
    id,
    title,
    pipeline_id: pipelineId,
    training_address: trainingAddress,
    sede_label: sedeLabel,
    caes_label: caesLabel,
    fundae_label: fundaeLabel,
    hotel_label: hotelLabel,
    transporte,
  } satisfies CalendarVariantDeal;
}

/** ====== Selects para la query de variants ====== */
const variantSelectionBase = {
  id: true,
  id_woo: true,
  name: true,
  status: true,
  price: true,
  stock: true,
  stock_status: true,
  sede: true,
  date: true,
  trainer_id: true,
  sala_id: true,
  unidad_movil_id: true,
  created_at: true,
  updated_at: true,
  products: {
    select: {
      id: true,
      id_woo: true,
      name: true,
      code: true,
      category: true,
      hora_inicio: true,
      hora_fin: true,
      variant_start: true,
      variant_end: true,
      variant_stock_status: true,
      variant_stock_quantity: true,
      variant_price: true,
    },
  },
};

const variantSelectionWithResources = {
  ...variantSelectionBase,
  trainers: { select: { trainer_id: true, name: true, apellido: true } },
  salas: { select: { sala_id: true, name: true, sede: true } },
  unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } },
};

/** toMaybeString: convierte un valor con .toString() (ej. Decimal/BigInt wrapper) a string seguro */
function toMaybeString(value: unknown): string | null {
  try {
    if (value != null && typeof (value as any).toString === 'function') {
      const s = (value as any).toString();
      return typeof s === 'string' ? s : String(s);
    }
  } catch {
    // ignoramos errores de toString no seguro
  }
  return null;
}

/** ====== Handler ====== */
export const handler = async (event: any) => {
  const corsCheck = ensureCors(event);
  if (typeof corsCheck !== 'string') {
    return corsCheck;
  }

  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse(corsCheck);
    }

    if (event.httpMethod !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    ensureMadridTimezone();

    const qs = event.queryStringParameters ?? {};

    // Acepta start/end, from_utc/to_utc, o from/to. Si solo viene inicio, usa mismo día como fin.
    const startRaw = getFirstParam(qs, ['start', 'from_utc', 'from']) ?? null;
    const endRaw = getFirstParam(qs, ['end', 'to_utc', 'to']) ?? startRaw; // fallback: mismo día

    const startDate = parseDateFlex(startRaw);
    const endDate = parseDateFlex(endRaw);

    const range = ensureValidRange(startDate, endDate);
    if (!range) {
      return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);
    }

    // Límite máximo igual que en sessions: 120 días
    const maxRangeMs = 120 * 24 * 60 * 60 * 1000;
    if (range.end.getTime() - range.start.getTime() > maxRangeMs) {
      return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);
    }

    const prisma = getPrisma();

    const buildQuery = (includeResources: boolean) =>
      prisma.variants.findMany({
        where: {
          date: {
            not: null,
            gte: range.start,
            lte: range.end,
          },
        },
        orderBy: [{ date: 'asc' }, { name: 'asc' }],
        select: (includeResources ? variantSelectionWithResources : variantSelectionBase) as any,
      });

    let variants;
    try {
      // Intentamos siempre con recursos
      variants = await buildQuery(true);
      setVariantResourceColumnsSupport(true);
    } catch (error) {
      if (isVariantResourceColumnError(error)) {
        // Fallback sin relaciones si en algún entorno faltan columnas
        setVariantResourceColumnsSupport(false);
        console.warn(
          '[calendar-variants] falling back to legacy variant query (missing resource columns)',
          { error },
        );
        variants = await buildQuery(false);
      } else {
        throw error;
      }
    }

    const events: CalendarVariantEvent[] = [];

    // Claves únicas de variación (Woo)
    const variantWooIds = Array.isArray(variants)
      ? Array.from(
          new Set(
            (variants as any[])
              .map((variant: any) => {
                if (variant?.id_woo === null || variant?.id_woo === undefined) return null;
                const rawId = variant.id_woo;
                if (typeof rawId === 'bigint') return rawId.toString();
                if (typeof rawId === 'number') return Number.isFinite(rawId) ? String(rawId) : null;
                if (typeof rawId === 'object' && rawId !== null && 'toString' in rawId) {
                  return toMaybeString(rawId);
                }
                if (typeof rawId === 'string') {
                  const trimmed = rawId.trim();
                  return trimmed.length ? trimmed : null;
                }
                return null;
              })
              .filter((id): id is string => Boolean(id)),
          ),
        )
      : [];

    const studentsCountByVariant = new Map<string, number>();
    const dealsByVariant = new Map<string, CalendarVariantDeal[]>();

    if (variantWooIds.length) {
      const dealsWithCounts = await prisma.deals.findMany({
        where: { w_id_variation: { in: variantWooIds } },
        select: {
          deal_id: true,
          title: true,
          pipeline_id: true,
          training_address: true,
          sede_label: true,
          caes_label: true,
          fundae_label: true,
          hotel_label: true,
          transporte: true,
          w_id_variation: true,
          _count: {
            select: { alumnos: true },
          },
        },
      });

      (dealsWithCounts as DealRow[]).forEach((deal: DealRow) => {
        let keyRaw: string | null = null;
        if (typeof deal.w_id_variation === 'string') {
          const trimmed = deal.w_id_variation.trim();
          keyRaw = trimmed.length ? trimmed : null;
        } else if (typeof deal.w_id_variation === 'number') {
          keyRaw = Number.isFinite(deal.w_id_variation) ? String(deal.w_id_variation) : null;
        }
        if (!keyRaw) return;

        const rawCount = deal?._count?.alumnos;
        const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0;
        studentsCountByVariant.set(keyRaw, (studentsCountByVariant.get(keyRaw) ?? 0) + count);

        const normalizedDeal = sanitizeVariantDeal({
          deal_id: deal.deal_id ?? null,
          title: deal.title ?? null,
          pipeline_id: deal.pipeline_id ?? null,
          training_address: deal.training_address ?? null,
          sede_label: deal.sede_label ?? null,
          caes_label: deal.caes_label ?? null,
          fundae_label: deal.fundae_label ?? null,
          hotel_label: deal.hotel_label ?? null,
          transporte: deal.transporte ?? null,
        });

        if (normalizedDeal) {
          const list = dealsByVariant.get(keyRaw) ?? [];
          list.push(normalizedDeal);
          dealsByVariant.set(keyRaw, list);
        }
      });
    }

    (Array.isArray(variants) ? variants : []).forEach((variant) => {
      const record = variant as any;
      const productRecord = (record as any)?.product ?? (record as any)?.products ?? null;
      if (!productRecord) {
        console.warn('[calendar-variants] skipping variant without product', {
          variantId: record.id,
        });
        return;
      }

      const product = normalizeProductRecord(productRecord);
      const variantDate = toDate(record.date);
      const times = computeEventTimes(variantDate, product);
      if (!times) return;

      // clave woo de la variación
      let wooIdKey: string | null = null;
      if (record?.id_woo !== null && record?.id_woo !== undefined) {
        const rawId = record.id_woo;
        if (typeof rawId === 'bigint') wooIdKey = rawId.toString();
        else if (typeof rawId === 'number') wooIdKey = Number.isFinite(rawId) ? String(rawId) : null;
        else if (typeof rawId === 'string') wooIdKey = rawId.trim().length ? rawId.trim() : null;
        else if (rawId && typeof rawId === 'object' && 'toString' in rawId) {
          wooIdKey = toMaybeString(rawId);
        }
      }

      const studentsTotal = wooIdKey ? studentsCountByVariant.get(wooIdKey) ?? 0 : null;
      const variantDeals = wooIdKey ? dealsByVariant.get(wooIdKey) ?? [] : [];

      const normalizedVariant = normalizeVariantRecord(record, studentsTotal);

      const pushEvent = (id: string, start: Date, end: Date) => {
        events.push({
          id,
          start: start.toISOString(),
          end: end.toISOString(),
          product,
          variant: normalizedVariant,
          deals: variantDeals,
        });
      };

      pushEvent(record.id, times.start, times.end);

      // duplicado para verticales 2 días
      if (variantDate && isTwoDayVerticalProduct(product)) {
        const nextDayDate = new Date(variantDate.getTime());
        nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
        const nextTimes = computeEventTimes(nextDayDate, product);
        if (nextTimes) {
          pushEvent(`${record.id}:day2`, nextTimes.start, nextTimes.end);
        }
      }
    });

    return successResponse({
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      variants: events,
    });
  } catch (error) {
    console.error('[calendar-variants] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
