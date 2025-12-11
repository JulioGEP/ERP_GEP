// backend/functions/variant-sessions-create.ts

import { Prisma } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { buildMadridDateTime } from './_shared/time';

function normalizeDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

function formatDateKey(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  if (!request.rawBody) {
    return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición requerido', 400);
  }

  const payload = request.body && typeof request.body === 'object' ? (request.body as any) : {};
  const variantId = typeof payload.variant_id === 'string' ? payload.variant_id.trim() : '';
  if (!variantId) {
    return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);
  }

  const sessionsRaw: unknown[] = Array.isArray(payload.sessions) ? payload.sessions : [];
  if (!sessionsRaw.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes indicar al menos una sesión para duplicar.', 400);
  }

  const parsedSessions = sessionsRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const dateInfo = normalizeDate((item as any).date ?? (item as any).fecha);
      const trainerIds = Array.isArray((item as any).trainer_ids)
        ? (item as any).trainer_ids.map((value: unknown) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
        : [];
      return dateInfo ? { dateInfo, trainerIds } : null;
    })
    .filter((item): item is { dateInfo: { year: number; month: number; day: number }; trainerIds: string[] } => item !== null);

  if (!parsedSessions.length) {
    return errorResponse('VALIDATION_ERROR', 'Las fechas indicadas no son válidas.', 400);
  }

  const prisma = getPrisma();

  const baseVariant = await prisma.variants.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      id_woo: true,
      id_padre: true,
      name: true,
      status: true,
      finalizar: true,
      price: true,
      stock: true,
      stock_status: true,
      sede: true,
      trainer_id: true,
      sala_id: true,
      unidad_movil_id: true,
      products: {
        select: {
          hora_inicio: true,
          hora_fin: true,
        },
      },
    },
  });

  if (!baseVariant) {
    return errorResponse('NOT_FOUND', 'Variante no encontrada.', 404);
  }

  if (!baseVariant.id_woo) {
    return errorResponse('VALIDATION_ERROR', 'La variante no tiene un ID de WooCommerce configurado.', 400);
  }

  const existing = await prisma.variants.findMany({
    where: { id_padre: baseVariant.id_padre },
    select: { date: true },
  });
  const existingKeys = new Set(existing.map((variant) => formatDateKey(variant.date)).filter(Boolean) as string[]);

  const createdIds: string[] = [];
  let skipped = 0;

  const defaultStart =
    typeof baseVariant.products?.hora_inicio === 'string'
      ? baseVariant.products.hora_inicio.trim()
      : null;
  const startMatch = defaultStart?.match(/^(\d{2}):(\d{2})$/);
  const startHour = startMatch ? Number.parseInt(startMatch[1], 10) : 9;
  const startMinute = startMatch ? Number.parseInt(startMatch[2], 10) : 0;

  let placeholderCounter = 0;

  const buildPlaceholderIdWoo = () => {
    // Genera un identificador único (y distinto del de WooCommerce) para evitar colisiones
    // con la restricción de unicidad en la columna `id_woo` cuando se duplican sesiones.
    const base = BigInt(Date.now()) * 1000n + BigInt(placeholderCounter % 1000);
    placeholderCounter += 1;
    return base;
  };

  for (const session of parsedSessions) {
    const key = formatDateKey(buildMadridDateTime({
      year: session.dateInfo.year,
      month: session.dateInfo.month,
      day: session.dateInfo.day,
      hour: 0,
      minute: 0,
    }));

    if (key && existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    const dateValue = buildMadridDateTime({
      year: session.dateInfo.year,
      month: session.dateInfo.month,
      day: session.dateInfo.day,
      hour: startHour,
      minute: startMinute,
    });

    const trainerId = session.trainerIds[0] ?? baseVariant.trainer_id ?? null;

    const created = await prisma.variants.create({
      data: {
        id_woo: buildPlaceholderIdWoo(),
        id_padre: baseVariant.id_padre,
        name: baseVariant.name,
        status: baseVariant.status,
        finalizar: baseVariant.finalizar,
        price: baseVariant.price ? new Prisma.Decimal(baseVariant.price) : null,
        stock: baseVariant.stock,
        stock_status: baseVariant.stock_status,
        sede: baseVariant.sede,
        date: dateValue,
        trainer_id: trainerId ?? undefined,
        sala_id: baseVariant.sala_id ?? undefined,
        unidad_movil_id: baseVariant.unidad_movil_id ?? undefined,
      },
      select: { id: true },
    });

    createdIds.push(created.id);
    if (key) {
      existingKeys.add(key);
    }
  }

  const message = skipped
    ? 'Algunas fechas ya tenían una variante registrada y se omitieron.'
    : null;

  return successResponse({
    created_ids: createdIds,
    skipped,
    message,
  });
});
