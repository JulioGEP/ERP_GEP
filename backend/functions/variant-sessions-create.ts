// backend/functions/variant-sessions-create.ts

import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

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

  const baseVariantWooId = baseVariant.id_woo?.toString();

  const baseDeals = baseVariantWooId
    ? await prisma.deals.findMany({
        where: { w_id_variation: baseVariantWooId },
        include: { deal_products: true },
      })
    : [];

  const existing = await prisma.variants.findMany({
    where: { id_padre: baseVariant.id_padre },
    select: { date: true },
  });
  const existingKeys = new Set(existing.map((variant) => formatDateKey(variant.date)).filter(Boolean) as string[]);

  const createdIds: string[] = [];
  const createdVariants: Array<{ id: string; wooId: bigint }> = [];
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

    const newVariantWooId = buildPlaceholderIdWoo();

    const created = await prisma.variants.create({
      data: {
        id_woo: newVariantWooId,
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
    createdVariants.push({ id: created.id, wooId: newVariantWooId });
    if (key) {
      existingKeys.add(key);
    }
  }

  if (baseDeals.length && createdVariants.length) {
    for (const variant of createdVariants) {
      const variantWooId = variant.wooId.toString();

      for (const deal of baseDeals) {
        await prisma.deals.create({
          data: {
            deal_id: randomUUID(),
            title: deal.title ?? null,
            org_id: deal.org_id ?? undefined,
            pipeline_id: deal.pipeline_id ?? undefined,
            pipeline_label: deal.pipeline_label ?? undefined,
            estado_material: deal.estado_material ?? undefined,
            training_address: deal.training_address ?? undefined,
            sede_label: deal.sede_label ?? undefined,
            caes_label: deal.caes_label ?? undefined,
            fundae_label: deal.fundae_label ?? undefined,
            hotel_label: deal.hotel_label ?? undefined,
            person_id: deal.person_id ?? undefined,
            transporte: deal.transporte ?? undefined,
            po: deal.po ?? undefined,
            tipo_servicio: deal.tipo_servicio ?? undefined,
            mail_invoice: deal.mail_invoice ?? undefined,
            proveedores: deal.proveedores ?? undefined,
            observaciones: deal.observaciones ?? undefined,
            fecha_estimada_entrega_material: deal.fecha_estimada_entrega_material ?? undefined,
            direccion_envio: deal.direccion_envio ?? undefined,
            forma_pago_material: deal.forma_pago_material ?? undefined,
            comercial: deal.comercial ?? undefined,
            a_fecha: deal.a_fecha ?? undefined,
            w_id_variation: variantWooId,
            presu_holded: deal.presu_holded ?? undefined,
            modo_reserva: deal.modo_reserva ?? undefined,
            caes_val: deal.caes_val ?? undefined,
            fundae_val: deal.fundae_val ?? undefined,
            hotel_val: deal.hotel_val ?? undefined,
            transporte_val: deal.transporte_val ?? undefined,
            po_val: deal.po_val ?? undefined,
            deal_products: {
              create: deal.deal_products.map((product) => ({
                id: randomUUID(),
                name: product.name ?? undefined,
                code: product.code ?? undefined,
                quantity: new Prisma.Decimal(product.quantity ?? 0),
                price: new Prisma.Decimal(product.price ?? 0),
                type: product.type ?? undefined,
                hours: product.hours ? new Prisma.Decimal(product.hours) : undefined,
                product_comments: product.product_comments ?? undefined,
                category: product.category ?? undefined,
              })),
            },
          },
        });
      }
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
