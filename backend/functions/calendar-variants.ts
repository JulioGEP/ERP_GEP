// backend/functions/calendar-variants.ts
import { getPrisma } from './_shared/prisma';
import { ensureMadridTimezone, toMadridISOString } from './_shared/timezone';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import {
  getVariantResourceColumnsSupport,
  isVariantResourceColumnError,
  setVariantResourceColumnsSupport,
} from './_shared/variant-resources';

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
    default_variant_start: string | null;
    default_variant_end: string | null;
    default_variant_stock_status: string | null;
    default_variant_stock_quantity: number | null;
    default_variant_price: string | null;
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

function parseDate(value: unknown): Date | null {
  const text = toTrimmed(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
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
    trainer?: { trainer_id: string; name: string | null; apellido: string | null } | null;
    sala?: { sala_id: string; name: string; sede: string | null } | null;
    unidad?: { unidad_id: string; name: string; matricula: string | null } | null;
    created_at: Date | null;
    updated_at: Date | null;
  },
  studentsTotal?: number | null,
) {
  const normalizedStudentsTotal =
    typeof studentsTotal === 'number' && Number.isFinite(studentsTotal) ? studentsTotal : null;

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
    trainer: record.trainer
      ? {
          trainer_id: record.trainer.trainer_id,
          name: record.trainer.name ?? null,
          apellido: record.trainer.apellido ?? null,
        }
      : null,
    sala_id: record.sala_id ?? null,
    sala: record.sala
      ? { sala_id: record.sala.sala_id, name: record.sala.name, sede: record.sala.sede ?? null }
      : null,
    unidad_movil_id: record.unidad_movil_id ?? null,
    unidad: record.unidad
      ? {
          unidad_id: record.unidad.unidad_id,
          name: record.unidad.name,
          matricula: record.unidad.matricula ?? null,
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
  default_variant_start: Date | null;
  default_variant_end: Date | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: string | number | null;
}) {
  return {
    id: record.id,
    id_woo: record.id_woo != null ? record.id_woo.toString() : null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
    default_variant_start: toMadridISOString(record.default_variant_start),
    default_variant_end: toMadridISOString(record.default_variant_end),
    default_variant_stock_status: record.default_variant_stock_status ?? null,
    default_variant_stock_quantity: record.default_variant_stock_quantity ?? null,
    default_variant_price:
      record.default_variant_price == null
        ? null
        : typeof record.default_variant_price === 'string'
          ? record.default_variant_price
          : record.default_variant_price.toString(),
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
  created_at: true,
  updated_at: true,
  product: {
    select: {
      id: true,
      id_woo: true,
      name: true,
      code: true,
      category: true,
      hora_inicio: true,
      hora_fin: true,
      default_variant_start: true,
      default_variant_end: true,
      default_variant_stock_status: true,
      default_variant_stock_quantity: true,
      default_variant_price: true,
    },
  },
};

const variantSelectionWithResources = {
  ...variantSelectionBase,
  trainer_id: true,
  sala_id: true,
  unidad_movil_id: true,
  trainer: { select: { trainer_id: true, name: true, apellido: true } },
  sala: { select: { sala_id: true, name: true, sede: true } },
  unidad: { select: { unidad_id: true, name: true, matricula: true } },
};

type RawProductRecord = {
  id: unknown;
  id_woo: unknown;
  name: unknown;
  code: unknown;
  category: unknown;
  hora_inicio: unknown;
  hora_fin: unknown;
  default_variant_start: unknown;
  default_variant_end: unknown;
  default_variant_stock_status: unknown;
  default_variant_stock_quantity: unknown;
  default_variant_price: unknown;
};

type RawTrainerRecord = {
  trainer_id: unknown;
  name: unknown;
  apellido: unknown;
};

type RawSalaRecord = {
  sala_id: unknown;
  name: unknown;
  sede: unknown;
};

type RawUnidadRecord = {
  unidad_id: unknown;
  name: unknown;
  matricula: unknown;
};

type RawVariantRow = {
  id: string;
  id_woo: unknown;
  name: string | null;
  status: string | null;
  price: unknown;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  trainer_id: string | null;
  sala_id: string | null;
  unidad_movil_id: string | null;
  product: unknown;
  trainer: unknown;
  sala: unknown;
  unidad: unknown;
};

function toJsonRecord<T extends Record<string, unknown>>(value: unknown): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as T;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function findVariantsWithRawQuery(
  prisma: ReturnType<typeof getPrisma>,
  includeResources: boolean,
  range: DateRange,
) {
  const rows = await prisma.$queryRaw<RawVariantRow[]>`
    SELECT
      v.id,
      v.id_woo,
      v.name,
      v.status,
      v.price,
      v.stock,
      v.stock_status,
      v.sede,
      v.date,
      v.created_at,
      v.updated_at,
      v.trainer_id,
      v.sala_id,
      v.unidad_movil_id,
      CASE
        WHEN p.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', p.id,
          'id_woo', p.id_woo,
          'name', p.name,
          'code', p.code,
          'category', p.category,
          'hora_inicio', p.hora_inicio,
          'hora_fin', p.hora_fin,
          'default_variant_start', p.variant_start,
          'default_variant_end', p.variant_end,
          'default_variant_stock_status', p.variant_stock_status,
          'default_variant_stock_quantity', p.variant_stock_quantity,
          'default_variant_price', p.variant_price
        )
      END AS product,
      CASE
        WHEN t.trainer_id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'trainer_id', t.trainer_id,
          'name', t.name,
          'apellido', t.apellido
        )
      END AS trainer,
      CASE
        WHEN s.sala_id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'sala_id', s.sala_id,
          'name', s.name,
          'sede', s.sede
        )
      END AS sala,
      CASE
        WHEN u.unidad_id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'unidad_id', u.unidad_id,
          'name', u.name,
          'matricula', u.matricula
        )
      END AS unidad
    FROM variants v
    LEFT JOIN products p ON p.id_woo = v.id_padre
    LEFT JOIN trainers t ON t.trainer_id = v.trainer_id
    LEFT JOIN salas s ON s.sala_id = v.sala_id
    LEFT JOIN unidades_moviles u ON u.unidad_id = v.unidad_movil_id
    WHERE
      v.date IS NOT NULL
      AND v.date >= ${range.start}
      AND v.date <= ${range.end}
    ORDER BY v.date ASC, v.name ASC NULLS LAST
  `;

  return rows.map((row: RawVariantRow) => {
    const productRecord = toJsonRecord<RawProductRecord>(row.product);
    const productId = productRecord ? toMaybeString(productRecord.id) : null;
    const product =
      productRecord && productId
        ? {
            id: productId,
            id_woo: productRecord.id_woo ?? null,
            name: typeof productRecord.name === 'string' ? productRecord.name : null,
            code: typeof productRecord.code === 'string' ? productRecord.code : null,
            category: typeof productRecord.category === 'string' ? productRecord.category : null,
            hora_inicio:
              productRecord.hora_inicio == null ? null : (productRecord.hora_inicio as string),
            hora_fin: productRecord.hora_fin == null ? null : (productRecord.hora_fin as string),
            default_variant_start: (productRecord.default_variant_start as Date | string | null) ?? null,
            default_variant_end: (productRecord.default_variant_end as Date | string | null) ?? null,
            default_variant_stock_status:
              typeof productRecord.default_variant_stock_status === 'string'
                ? productRecord.default_variant_stock_status
                : null,
            default_variant_stock_quantity: toNullableNumber(
              productRecord.default_variant_stock_quantity,
            ),
            default_variant_price:
              productRecord.default_variant_price == null
                ? null
                : (productRecord.default_variant_price as string | number),
          }
        : null;

    const base: Record<string, unknown> = {
      id: row.id,
      id_woo: row.id_woo,
      name: row.name,
      status: row.status,
      price: row.price,
      stock: row.stock,
      stock_status: row.stock_status,
      sede: row.sede,
      date: row.date,
      created_at: row.created_at,
      updated_at: row.updated_at,
      product,
    };

    if (includeResources) {
      const trainerRecord = toJsonRecord<RawTrainerRecord>(row.trainer);
      const salaRecord = toJsonRecord<RawSalaRecord>(row.sala);
      const unidadRecord = toJsonRecord<RawUnidadRecord>(row.unidad);

      base.trainer_id = row.trainer_id ?? null;
      base.trainer = trainerRecord
        ? {
            trainer_id: toMaybeString(trainerRecord.trainer_id),
            name: typeof trainerRecord.name === 'string' ? trainerRecord.name : null,
            apellido: typeof trainerRecord.apellido === 'string' ? trainerRecord.apellido : null,
          }
        : null;
      base.sala_id = row.sala_id ?? null;
      base.sala = salaRecord
        ? {
            sala_id: toMaybeString(salaRecord.sala_id),
            name: typeof salaRecord.name === 'string' ? salaRecord.name : null,
            sede: typeof salaRecord.sede === 'string' ? salaRecord.sede : null,
          }
        : null;
      base.unidad_movil_id = row.unidad_movil_id ?? null;
      base.unidad = unidadRecord
        ? {
            unidad_id: toMaybeString(unidadRecord.unidad_id),
            name: typeof unidadRecord.name === 'string' ? unidadRecord.name : null,
            matricula: typeof unidadRecord.matricula === 'string' ? unidadRecord.matricula : null,
          }
        : null;
    }

    return base;
  });
}

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
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    ensureMadridTimezone();

    const { start: startParam, end: endParam } = event.queryStringParameters ?? {};
    const range = ensureValidRange(parseDate(startParam), parseDate(endParam));
    if (!range) {
      return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);
    }

    const prisma = getPrisma();
    const hasVariantDelegate = Boolean((prisma as any)?.variants?.findMany);
    const shouldIncludeResources = getVariantResourceColumnsSupport() !== false;

    const buildQuery = (includeResources: boolean) =>
      hasVariantDelegate
        ? prisma.variants.findMany({
            where: {
              date: {
                not: null,
                gte: range.start,
                lte: range.end,
              },
            },
            orderBy: [{ date: 'asc' }, { name: 'asc' }],
            select: (includeResources ? variantSelectionWithResources : variantSelectionBase) as any,
          })
        : findVariantsWithRawQuery(prisma, includeResources, range);

    let variants;
    try {
      variants = await buildQuery(shouldIncludeResources);
      if (shouldIncludeResources) {
        setVariantResourceColumnsSupport(true);
      }
    } catch (error) {
      if (shouldIncludeResources && isVariantResourceColumnError(error)) {
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
            variants
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

      // === BLOQUE con tipos fuertes (DealRow) ===
      dealsWithCounts.forEach((deal: DealRow) => {
        // normaliza la clave de variación
        let keyRaw: string | null = null;
        if (typeof deal.w_id_variation === 'string') {
          const trimmed = deal.w_id_variation.trim();
          keyRaw = trimmed.length ? trimmed : null;
        } else if (typeof deal.w_id_variation === 'number') {
          keyRaw = Number.isFinite(deal.w_id_variation) ? String(deal.w_id_variation) : null;
        }
        if (!keyRaw) return;

        // suma alumnos
        const rawCount = deal?._count?.alumnos;
        const count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? rawCount : 0;
        studentsCountByVariant.set(keyRaw, (studentsCountByVariant.get(keyRaw) ?? 0) + count);

        // normaliza deal
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
      if (!record?.product) return;

      const product = normalizeProductRecord(record.product);
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
