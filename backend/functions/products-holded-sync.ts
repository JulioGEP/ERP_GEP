// backend/functions/products-holded-sync.ts
import { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const HOLDED_CREATE_URL = 'https://api.holded.com/api/invoicing/v1/products';
const HOLDED_UPDATE_URL = 'https://api.holded.com/api/invoicing/v1/products';

const DEFAULT_TAX = 21;
const REQUEST_TIMEOUT_MS = 15_000;

function toSafeNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getProductName(product: { name: string | null; code: string | null; id_pipe: string }): string {
  const fallback = `Producto ${product.id_pipe}`;
  return product.name?.trim() || product.code?.trim() || fallback;
}

type HoldedSyncResult = {
  productId: string;
  idPipe: string;
  holdedId: string | null;
  action: 'create' | 'update';
  status: 'success' | 'error';
  message: string;
  name: string | null;
};

type HoldedResponse = {
  ok: boolean;
  statusCode: number;
  statusText: string;
  json: any;
  rawBody: string;
};

function buildHoldedError(response: HoldedResponse, fallback: string) {
  const info = typeof response.json?.info === 'string' ? response.json.info.trim() : '';
  if (info.length) return info;
  const raw = response.rawBody?.trim?.();
  if (raw?.length) return raw;
  return `${fallback} (${response.statusCode} ${response.statusText})`;
}

async function sendHoldedRequest(
  url: string,
  method: 'POST' | 'PUT',
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<HoldedResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        key: apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let json: any = null;
    try {
      json = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      statusCode: response.status,
      statusText: response.statusText,
      json,
      rawBody,
    };
  } catch (error) {
    if ((error as any)?.name === 'AbortError') {
      return {
        ok: false,
        statusCode: 408,
        statusText: 'Request Timeout',
        json: null,
        rawBody: 'Tiempo de espera agotado comunicando con Holded',
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) break;
      results[currentIndex] = await worker(item, currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const apiKey = process.env.API_HOLDED_KEY;
  if (!apiKey) {
    return errorResponse('CONFIG_ERROR', 'API_HOLDED_KEY no está configurada', 500);
  }

  const prisma = getPrisma();
  const products = await prisma.products.findMany({
    orderBy: [{ name: 'asc' }, { id_pipe: 'asc' }],
  });

  const now = new Date();

  const results = await mapWithConcurrency(products, 5, async (product) => {
    const name = getProductName(product as any);
    const sku = `SKU${product.id_pipe}`;
    const basePayload = {
      kind: 'simple',
      name,
      tax: DEFAULT_TAX,
      sku,
    } as const;

    try {
      if (!product.id_holded) {
        const payload = { ...basePayload, price: toSafeNumber(product.price as any) };
        const response = await sendHoldedRequest(HOLDED_CREATE_URL, 'POST', apiKey, payload);
        const holdedId = typeof response.json?.id === 'string' ? response.json.id : null;

        if (!response.ok || response.json?.status !== 1 || !holdedId) {
          throw new Error(buildHoldedError(response, 'Error al crear producto en Holded'));
        }

        await prisma.products.update({
          where: { id: product.id },
          data: { id_holded: holdedId, updated_at: now },
        });

        return {
          productId: product.id,
          idPipe: product.id_pipe,
          holdedId,
          action: 'create' as const,
          status: 'success' as const,
          message: 'Producto creado en Holded',
          name,
        } satisfies HoldedSyncResult;
      } else {
        const payload = { ...basePayload, subtotal: toSafeNumber(product.price as any) };
        const url = `${HOLDED_UPDATE_URL}/${encodeURIComponent(product.id_holded)}`;
        const response = await sendHoldedRequest(url, 'PUT', apiKey, payload);

        if (!response.ok || response.json?.status !== 1) {
          throw new Error(buildHoldedError(response, 'Error al actualizar producto en Holded'));
        }

        return {
          productId: product.id,
          idPipe: product.id_pipe,
          holdedId: product.id_holded,
          action: 'update' as const,
          status: 'success' as const,
          message: 'Producto actualizado en Holded',
          name,
        } satisfies HoldedSyncResult;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido al sincronizar con Holded';
      return {
        productId: product.id,
        idPipe: product.id_pipe,
        holdedId: product.id_holded ?? null,
        action: product.id_holded ? ('update' as const) : ('create' as const),
        status: 'error' as const,
        message,
        name,
      } satisfies HoldedSyncResult;
    }
  });

  return successResponse({ ok: true, results });
});
