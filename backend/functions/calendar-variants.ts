// backend/functions/calendar-variants.ts
import type { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { ensureMadridTimezone, toMadridISOString } from './_shared/timezone';
import { formatTimeFromDb } from './_shared/time';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

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
    created_at: string | null;
    updated_at: string | null;
  };
};

type DateRange = { start: Date; end: Date };

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
  if (!start || !end) {
    return null;
  }

  if (end.getTime() < start.getTime()) {
    return null;
  }

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

function buildDateTime(
  date: Date,
  time: TimeParts | null,
  fallback: TimeParts,
): Date {
  const parts = time ?? fallback;
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return new Date(Date.UTC(year, month, day, parts.hour, parts.minute, 0, 0));
}

function normalizeVariantRecord(record: {
  id: string;
  id_woo: Prisma.Decimal | bigint | number;
  name: string | null;
  status: string | null;
  price: Prisma.Decimal | string | number | null;
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
}) {
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
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  };
}

function normalizeProductRecord(record: {
  id: string;
  id_woo: Prisma.Decimal | bigint | number | null;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: Date | string | null;
  hora_fin: Date | string | null;
  default_variant_start: Date | null;
  default_variant_end: Date | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: Prisma.Decimal | string | number | null;
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

function computeEventTimes(variantDate: Date | null, product: { hora_inicio: string | null; hora_fin: string | null }) {
  if (!variantDate) {
    return null;
  }

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

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

    const variants = await prisma.variants.findMany({
      where: {
        date: {
          not: null,
          gte: range.start,
          lte: range.end,
        },
      },
      orderBy: [{ date: 'asc' as Prisma.SortOrder }, { name: 'asc' as Prisma.SortOrder }],
      select: {
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
        trainer: { select: { trainer_id: true, name: true, apellido: true } },
        sala: { select: { sala_id: true, name: true, sede: true } },
        unidad: { select: { unidad_id: true, name: true, matricula: true } },
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
      },
    });

    const events: CalendarVariantEvent[] = [];

    variants.forEach((variant) => {
      if (!variant.product) {
        return;
      }

      const product = normalizeProductRecord(variant.product);
      const times = computeEventTimes(variant.date, product);
      if (!times) {
        return;
      }

      const normalizedVariant = normalizeVariantRecord(variant);

      events.push({
        id: variant.id,
        start: times.start.toISOString(),
        end: times.end.toISOString(),
        product,
        variant: normalizedVariant,
      });
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

