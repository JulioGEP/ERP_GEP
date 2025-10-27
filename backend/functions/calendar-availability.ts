// backend/functions/calendar-availability.ts
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { buildMadridDateTime } from './_shared/time';
import { ensureMadridTimezone } from './_shared/timezone';
import {
  getVariantResourceColumnsSupport,
  isVariantResourceColumnError,
  setVariantResourceColumnsSupport,
} from './_shared/variant-resources';

type DateRange = { start: Date; end: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const MADRID_TIME_ZONE = 'Europe/Madrid';
const ALWAYS_AVAILABLE_UNIT_IDS = new Set(['52377f13-05dd-4830-88aa-0f5c78bee750']);

type SedeCode = 'ARG' | 'SAB';
type ResourceKey = 'rooms' | 'units' | 'trainers';

const SEDE_CATALOG: Record<SedeCode, { label: string; aliases: string[] }> = {
  ARG: {
    label: 'GEP Arganda',
    aliases: [
      'gep arganda',
      'arg',
      'arganda',
      'c/ primavera, 1, 28500, arganda del rey, madrid',
    ],
  },
  SAB: {
    label: 'GEP Sabadell',
    aliases: ['gep sabadell', 'sab', 'sabadell', 'c/ moratín, 100, 08206 sabadell, barcelona'],
  },
};

const SEDES: SedeCode[] = ['ARG', 'SAB'];
const RESOURCE_KEYS: ResourceKey[] = ['rooms', 'units', 'trainers'];

const madridDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MADRID_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function parseDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const text = String(value).trim();
  if (!text.length) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function normalizeDateRange(start: Date | null | undefined, end: Date | null | undefined): DateRange | null {
  const effectiveStart = start ?? end ?? null;
  const effectiveEnd = end ?? start ?? null;
  if (!effectiveStart || !effectiveEnd) {
    return null;
  }

  const startTime = effectiveStart.getTime();
  const endTime = effectiveEnd.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return null;
  }

  return { start: new Date(startTime), end: new Date(endTime) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDayKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getMadridDateParts(date: Date): { year: number; month: number; day: number } {
  const formatted = madridDateFormatter.format(date);
  const [yearText, monthText, dayText] = formatted.split('-');
  return {
    year: Number.parseInt(yearText, 10),
    month: Number.parseInt(monthText, 10),
    day: Number.parseInt(dayText, 10),
  };
}

function buildMadridMidday(date: Date): Date {
  const parts = getMadridDateParts(date);
  return buildMadridDateTime({ year: parts.year, month: parts.month, day: parts.day, hour: 12, minute: 0 });
}

function iterateMadridDays(range: DateRange, callback: (dayKey: string) => void): void {
  const startMidday = buildMadridMidday(range.start);
  const endMidday = buildMadridMidday(range.end);
  for (
    let cursor = startMidday.getTime(),
      endTime = endMidday.getTime();
    cursor <= endTime;
    cursor += DAY_MS
  ) {
    const current = new Date(cursor);
    const parts = getMadridDateParts(current);
    callback(formatDayKey(parts));
  }
}

function clampRange(range: DateRange, bounds: DateRange): DateRange | null {
  const start = range.start.getTime() < bounds.start.getTime() ? bounds.start : range.start;
  const end = range.end.getTime() > bounds.end.getTime() ? bounds.end : range.end;
  if (end.getTime() < bounds.start.getTime() || start.getTime() > bounds.end.getTime()) {
    return null;
  }
  if (end.getTime() < start.getTime()) {
    return null;
  }
  return { start, end };
}

function normalizeSede(value: unknown): SedeCode | null {
  const text = toTrimmed(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  for (const sede of SEDES) {
    const { label, aliases } = SEDE_CATALOG[sede];
    if (label.toLowerCase() === normalized) return sede;
    if (aliases.includes(normalized)) return sede;
  }
  return null;
}

type ResourceTotals = Record<SedeCode, Record<ResourceKey, number>>;

type DayAccumulator = Record<
  SedeCode,
  Record<ResourceKey, { total: number; booked: Set<string> }>
>;

function createDayAccumulator(totals: ResourceTotals): DayAccumulator {
  return {
    ARG: {
      rooms: { total: totals.ARG.rooms, booked: new Set() },
      units: { total: totals.ARG.units, booked: new Set() },
      trainers: { total: totals.ARG.trainers, booked: new Set() },
    },
    SAB: {
      rooms: { total: totals.SAB.rooms, booked: new Set() },
      units: { total: totals.SAB.units, booked: new Set() },
      trainers: { total: totals.SAB.trainers, booked: new Set() },
    },
  } satisfies DayAccumulator;
}

type RoomRecord = { sala_id: string; sede: string };
type TrainerRecord = { trainer_id: string; sede: string[] | null; activo: boolean };
type UnitRecord = { unidad_id: string; sede: string[] | null };

type SessionRecord = {
  fecha_inicio_utc: Date | null;
  fecha_fin_utc: Date | null;
  sala_id: string | null;
  sala: { sala_id: string; sede: string } | null;
  deal: { sede_label: string | null } | null;
  trainers: Array<{ trainer: TrainerRecord | null }>;
  unidades: Array<{ unidad: UnitRecord | null }>;
};

type VariantRecord = {
  id: string;
  date: Date | null;
  sede: string | null;
  trainer_id: string | null;
  sala_id: string | null;
  unidad_movil_id: string | null;
  trainer: TrainerRecord | null;
  sala: RoomRecord | null;
  unidad: UnitRecord | null;
  product: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
};

function extractResourceSedesFromArray(values: string[] | null | undefined): SedeCode[] {
  if (!Array.isArray(values)) return [];
  const sedes: SedeCode[] = [];
  for (const value of values) {
    const sede = normalizeSede(value);
    if (sede && !sedes.includes(sede)) {
      sedes.push(sede);
    }
  }
  return sedes;
}

function computeVariantRange(
  variantDate: Date | null,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null,
): DateRange | null {
  if (!variantDate) return null;
  const baseDate = new Date(variantDate);
  if (Number.isNaN(baseDate.getTime())) return null;

  const startTime = extractVariantTimeParts(productTimes?.hora_inicio);
  const endTime = extractVariantTimeParts(productTimes?.hora_fin);
  const fallbackStart: VariantTimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: VariantTimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildVariantDateTime(baseDate, startTime, fallbackStart);
  let end = buildVariantDateTime(baseDate, endTime, fallbackEnd);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  return { start, end };
}

type VariantTimeParts = { hour: number; minute: number };

function extractVariantTimeParts(value: Date | string | null | undefined): VariantTimeParts | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return { hour: value.getUTCHours(), minute: value.getUTCMinutes() };
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildVariantDateTime(date: Date, time: VariantTimeParts | null, fallback: VariantTimeParts): Date {
  const parts = time ?? fallback;
  const madridParts = getMadridDateParts(date);
  return buildMadridDateTime({
    year: madridParts.year,
    month: madridParts.month,
    day: madridParts.day,
    hour: parts.hour,
    minute: parts.minute,
  });
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'GET') {
      return errorResponse('NOT_IMPLEMENTED', 'Método no soportado', 404);
    }

    const startParam = toTrimmed(event.queryStringParameters?.start);
    const endParam = toTrimmed(event.queryStringParameters?.end);

    if (!startParam) {
      return errorResponse('VALIDATION_ERROR', 'El parámetro start es obligatorio', 400);
    }

    const startInput = parseDateInput(startParam);
    if (!startInput) {
      return errorResponse('VALIDATION_ERROR', 'El parámetro start es inválido', 400);
    }

    const endInput = parseDateInput(endParam ?? undefined) ?? startInput;
    if (!endInput) {
      return errorResponse('VALIDATION_ERROR', 'El parámetro end es inválido', 400);
    }

    const range = normalizeDateRange(startInput, endInput);
    if (!range) {
      return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);
    }

    ensureMadridTimezone();
    const prisma = getPrisma();

    const [rooms, units, trainers] = await Promise.all([
      prisma.salas.findMany({ select: { sala_id: true, sede: true } }),
      prisma.unidades_moviles.findMany({ select: { unidad_id: true, sede: true } }),
      prisma.trainers.findMany({ select: { trainer_id: true, sede: true, activo: true } }),
    ]);

    const roomSedes = new Map<string, SedeCode[]>();
    const unitSedes = new Map<string, SedeCode[]>();
    const trainerSedes = new Map<string, SedeCode[]>();

    const totals: ResourceTotals = {
      ARG: { rooms: 0, units: 0, trainers: 0 },
      SAB: { rooms: 0, units: 0, trainers: 0 },
    };

    rooms.forEach((room: RoomRecord) => {
      const sede = normalizeSede(room.sede);
      if (!sede) return;
      totals[sede].rooms += 1;
      roomSedes.set(room.sala_id, [sede]);
    });

    units.forEach((unit: UnitRecord) => {
      const sedes = extractResourceSedesFromArray(unit.sede);
      if (!sedes.length) return;
      unitSedes.set(unit.unidad_id, sedes);
      sedes.forEach((sede) => {
        totals[sede].units += 1;
      });
    });

    trainers.forEach((trainer: TrainerRecord) => {
      if (!trainer.activo) return;
      const sedes = extractResourceSedesFromArray(trainer.sede ?? []);
      if (!sedes.length) return;
      trainerSedes.set(trainer.trainer_id, sedes);
      sedes.forEach((sede) => {
        totals[sede].trainers += 1;
      });
    });

    const dayMap = new Map<string, DayAccumulator>();

    const ensureDay = (dayKey: string): DayAccumulator => {
      const existing = dayMap.get(dayKey);
      if (existing) return existing;
      const created = createDayAccumulator(totals);
      dayMap.set(dayKey, created);
      return created;
    };

    const registerBooking = (
      dayKey: string,
      sede: SedeCode,
      resource: ResourceKey,
      id: string,
    ) => {
      if (!id) return;
      const accumulator = ensureDay(dayKey);
      accumulator[sede][resource].booked.add(id);
    };

    const determineSessionSede = (session: SessionRecord): SedeCode | null => {
      const roomSede = session.sala ? normalizeSede(session.sala.sede) : null;
      if (roomSede) return roomSede;
      const dealSede = session.deal ? normalizeSede(session.deal.sede_label) : null;
      return dealSede;
    };

    const sessions = await prisma.sessions.findMany({
      where: {
        OR: [
          {
            fecha_inicio_utc: { lte: range.end },
            fecha_fin_utc: { gte: range.start },
          },
          {
            fecha_inicio_utc: { lte: range.end },
            fecha_fin_utc: null,
          },
          {
            fecha_inicio_utc: null,
            fecha_fin_utc: { gte: range.start },
          },
        ],
      },
      select: {
        fecha_inicio_utc: true,
        fecha_fin_utc: true,
        sala_id: true,
        sala: { select: { sala_id: true, sede: true } },
        deal: { select: { sede_label: true } },
        trainers: {
          select: {
            trainer: { select: { trainer_id: true, sede: true, activo: true } },
          },
        },
        unidades: {
          select: {
            unidad: { select: { unidad_id: true, sede: true } },
          },
        },
      },
    });

    sessions.forEach((session: SessionRecord) => {
      const sessionRange = normalizeDateRange(session.fecha_inicio_utc, session.fecha_fin_utc);
      if (!sessionRange) return;
      const clamped = clampRange(sessionRange, range);
      if (!clamped) return;

      const sessionSede = determineSessionSede(session);
      iterateMadridDays(clamped, (dayKey) => {
        if (session.sala_id) {
          const sedes = roomSedes.get(session.sala_id) ?? (session.sala ? [normalizeSede(session.sala.sede)].filter(Boolean) as SedeCode[] : []);
          sedes.forEach((sede) => registerBooking(dayKey, sede, 'rooms', session.sala_id!));
        }

        session.unidades.forEach(({ unidad }) => {
          if (!unidad || !unidad.unidad_id || ALWAYS_AVAILABLE_UNIT_IDS.has(unidad.unidad_id)) return;
          const sedes = unitSedes.get(unidad.unidad_id) ?? extractResourceSedesFromArray(unidad.sede);
          const applicable = sessionSede && sedes.includes(sessionSede) ? [sessionSede] : sedes;
          applicable.forEach((sede) => registerBooking(dayKey, sede, 'units', unidad.unidad_id!));
        });

        session.trainers.forEach(({ trainer }) => {
          if (!trainer || !trainer.trainer_id || trainer.activo === false) return;
          const sedes = trainerSedes.get(trainer.trainer_id) ?? extractResourceSedesFromArray(trainer.sede);
          const applicable = sessionSede && sedes.includes(sessionSede) ? [sessionSede] : sedes;
          applicable.forEach((sede) => registerBooking(dayKey, sede, 'trainers', trainer.trainer_id!));
        });
      });
    });

    if (getVariantResourceColumnsSupport() !== false) {
      try {
        const variants = await prisma.variants.findMany({
          where: {
            date: { not: null },
            AND: [
              { date: { gte: new Date(range.start.getTime() - DAY_MS) } },
              { date: { lte: new Date(range.end.getTime() + DAY_MS) } },
            ],
          },
          select: {
            id: true,
            date: true,
            sede: true,
            trainer_id: true,
            sala_id: true,
            unidad_movil_id: true,
            trainer: { select: { trainer_id: true, sede: true, activo: true } },
            sala: { select: { sala_id: true, sede: true } },
            unidad: { select: { unidad_id: true, sede: true } },
            product: { select: { hora_inicio: true, hora_fin: true } },
          },
        });

        setVariantResourceColumnsSupport(true);

        variants.forEach((variant: VariantRecord) => {
          const variantRange = computeVariantRange(variant.date, variant.product ?? null);
          if (!variantRange) return;
          const clamped = clampRange(variantRange, range);
          if (!clamped) return;

          const variantSede = normalizeSede(variant.sede);

          iterateMadridDays(clamped, (dayKey) => {
            if (variant.sala_id) {
              const sedes = roomSedes.get(variant.sala_id) ?? (variant.sala ? [normalizeSede(variant.sala.sede)].filter(Boolean) as SedeCode[] : []);
              sedes.forEach((sede) => registerBooking(dayKey, sede, 'rooms', variant.sala_id!));
            }

            if (variant.unidad_movil_id && !ALWAYS_AVAILABLE_UNIT_IDS.has(variant.unidad_movil_id)) {
              const sedes = unitSedes.get(variant.unidad_movil_id) ?? extractResourceSedesFromArray(variant.unidad?.sede);
              const applicable = variantSede && sedes.includes(variantSede) ? [variantSede] : sedes;
              applicable.forEach((sede) => registerBooking(dayKey, sede, 'units', variant.unidad_movil_id!));
            }

            if (variant.trainer_id && variant.trainer?.activo !== false) {
              const sedes = trainerSedes.get(variant.trainer_id) ?? extractResourceSedesFromArray(variant.trainer?.sede);
              const applicable = variantSede && sedes.includes(variantSede) ? [variantSede] : sedes;
              applicable.forEach((sede) => registerBooking(dayKey, sede, 'trainers', variant.trainer_id!));
            }
          });
        });
      } catch (error) {
        if (isVariantResourceColumnError(error)) {
          setVariantResourceColumnsSupport(false);
          console.warn('[calendar-availability] variant resource columns not available', { error });
        } else {
          throw error;
        }
      }
    }

    iterateMadridDays(range, (dayKey) => {
      ensureDay(dayKey);
    });

    const days: Record<string, Record<SedeCode, Record<ResourceKey, { total: number; booked: number; available: number }>>> = {};

    dayMap.forEach((value, dayKey) => {
      const dayEntry: Record<SedeCode, Record<ResourceKey, { total: number; booked: number; available: number }>> = {
        ARG: { rooms: { total: 0, booked: 0, available: 0 }, units: { total: 0, booked: 0, available: 0 }, trainers: { total: 0, booked: 0, available: 0 } },
        SAB: { rooms: { total: 0, booked: 0, available: 0 }, units: { total: 0, booked: 0, available: 0 }, trainers: { total: 0, booked: 0, available: 0 } },
      };

      SEDES.forEach((sede) => {
        RESOURCE_KEYS.forEach((resource) => {
          const info = value[sede][resource];
          const booked = info.booked.size;
          const available = Math.max(info.total - booked, 0);
          dayEntry[sede][resource] = { total: info.total, booked, available };
        });
      });

      days[dayKey] = dayEntry;
    });

    return successResponse({
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      days,
    });
  } catch (error: unknown) {
    console.error('[calendar-availability] handler error', error);
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
