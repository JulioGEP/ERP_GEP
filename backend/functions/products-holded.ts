// backend/functions/products-holded.ts
import { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const HOLDED_BASE_URL = 'https://api.holded.com/api/invoicing/v1/products';
const HOLDED_TAX_VALUE = 21;

interface HoldedSyncResult {
  id: string;
  id_pipe: string;
  name: string | null;
  holded_id: string | null;
  action: 'created' | 'updated';
  status: 'success' | 'error';
  message?: string;
}

interface HoldedResponsePayload {
  status?: number;
  info?: string;
  id?: string;
}

function normalizePrice(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSku(idPipe: string): string {
  return `SKU${idPipe}`;
}

function sanitizeName(name: string | null | undefined, idPipe: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length) return trimmed;
  return `Producto ${idPipe}`;
}

async function sendHoldedRequest(
  method: 'POST' | 'PUT',
  url: string,
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<HoldedResponsePayload> {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      key: apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: HoldedResponsePayload | null = null;

  try {
    data = text ? (JSON.parse(text) as HoldedResponsePayload) : null;
  } catch (error) {
    console.error('[products-holded] Invalid JSON from Holded', error);
  }

  if (!response.ok) {
    const message = data?.info || data?.id || text || `Holded respondió ${response.status}`;
    throw new Error(message);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Respuesta inesperada de Holded');
  }

  if (data.status !== 1) {
    throw new Error(data.info || 'Holded devolvió un estado de error');
  }

  return data;
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const apiKey = (
    process.env.API_HOLDED_KEY || process.env.HOLDED_API_KEY || process.env.HOLDED_KEY || ''
  ).trim();
  if (!apiKey) {
    return errorResponse('CONFIG_ERROR', 'La clave de Holded no está configurada', 500);
  }

  const prisma = getPrisma();
  const products = await prisma.products.findMany({
    select: {
      id: true,
      id_pipe: true,
      id_holded: true,
      name: true,
      price: true,
    },
  });

  const results: HoldedSyncResult[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  const now = new Date();

  for (const product of products) {
    const name = sanitizeName(product.name, product.id_pipe);
    const price = normalizePrice(product.price) ?? 0;
    const sku = buildSku(product.id_pipe);

    try {
      if (!product.id_holded) {
        const payload = { kind: 'simple', name, price, tax: HOLDED_TAX_VALUE, sku };
        const response = await sendHoldedRequest('POST', HOLDED_BASE_URL, payload, apiKey);
        const holdedId = response.id ?? null;

        if (holdedId) {
          await prisma.products.update({
            where: { id: product.id },
            data: { id_holded: holdedId, updated_at: now },
          });
        }

        results.push({
          id: product.id,
          id_pipe: product.id_pipe,
          name: product.name,
          holded_id: holdedId,
          action: 'created',
          status: 'success',
          message: response.info || 'Producto creado en Holded',
        });
        created += 1;
      } else {
        const payload = { kind: 'simple', name, tax: HOLDED_TAX_VALUE, sku, subtotal: price };
        const response = await sendHoldedRequest(
          'PUT',
          `${HOLDED_BASE_URL}/${encodeURIComponent(product.id_holded)}`,
          payload,
          apiKey,
        );

        results.push({
          id: product.id,
          id_pipe: product.id_pipe,
          name: product.name,
          holded_id: product.id_holded,
          action: 'updated',
          status: 'success',
          message: response.info || 'Producto actualizado en Holded',
        });
        updated += 1;
      }
    } catch (error) {
      console.error('[products-holded] Failed to sync product', product.id_pipe, error);
      failed += 1;
      results.push({
        id: product.id,
        id_pipe: product.id_pipe,
        name: product.name,
        holded_id: product.id_holded ?? null,
        action: product.id_holded ? 'updated' : 'created',
        status: 'error',
        message: error instanceof Error ? error.message : 'Error desconocido al sincronizar con Holded',
      });
    }
  }

  return successResponse({
    ok: true,
    summary: {
      total: products.length,
      created,
      updated,
      failed,
    },
    results,
  });
});
