// backend/functions/products-holded-sync.ts
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const HOLDED_API_KEY = process.env.HOLDED_API_KEY ?? process.env.API_HOLDED_KEY;
const HOLDED_API_BASE_URL = process.env.HOLDED_API_BASE_URL ?? 'https://api.holded.com/api/invoicing/v1';

const DEFAULT_TAX = '21';
const DEFAULT_KIND = 'simple';

interface HoldedSyncResult {
  productId: string;
  id_pipe: string;
  name: string | null;
  action: 'create' | 'update';
  status: 'success' | 'error';
  message: string;
  holdedId: string | null;
}

interface HoldedApiResponse {
  status: number;
  bodyText: string;
  json: any;
}

type HoldedPayload = {
  kind: string;
  name: string;
  tax: string;
  sku: string;
  price?: number;
  subtotal?: number;
};

function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSku(idPipe: string): string {
  return `SKU${idPipe}`;
}

function resolveProductName(product: { name: string | null; code: string | null; id_pipe: string }): string {
  return product.name ?? product.code ?? `Producto ${product.id_pipe}`;
}

function extractHoldedId(json: any): string | null {
  if (!json || typeof json !== 'object') return null;
  const candidates = [json.id, json.productId, json._id];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = String(candidate).trim();
    if (text.length) return text;
  }
  return null;
}

async function callHoldedApi(path: string, method: 'POST' | 'PUT', payload: HoldedPayload): Promise<HoldedApiResponse> {
  const url = `${HOLDED_API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      key: String(HOLDED_API_KEY ?? ''),
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  let json: any = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch (error) {
    json = null;
  }

  if (!response.ok) {
    const message = json?.message ?? `Holded devolvió el estado ${response.status}`;
    throw new Error(message);
  }

  return { status: response.status, bodyText, json };
}

function buildCreatePayload(product: { name: string | null; id_pipe: string; price: Prisma.Decimal | number | null }) {
  const priceValue = toNumber(product.price) ?? 0;
  return {
    kind: DEFAULT_KIND,
    name: resolveProductName(product),
    price: priceValue,
    tax: DEFAULT_TAX,
    sku: buildSku(product.id_pipe),
  } satisfies HoldedPayload;
}

function buildUpdatePayload(product: { name: string | null; id_pipe: string; price: Prisma.Decimal | number | null }) {
  const priceValue = toNumber(product.price) ?? 0;
  return {
    kind: DEFAULT_KIND,
    name: resolveProductName(product),
    tax: DEFAULT_TAX,
    sku: buildSku(product.id_pipe),
    subtotal: priceValue,
  } satisfies HoldedPayload;
}

export const handler = createHttpHandler(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  if (!HOLDED_API_KEY) {
    return errorResponse(
      'CONFIG_ERROR',
      'Falta la variable HOLDED_API_KEY o API_HOLDED_KEY para conectar con Holded',
      500,
    );
  }

  const prisma = getPrisma();
  const products = await prisma.products.findMany({
    orderBy: [{ created_at: 'asc' }],
    select: {
      id: true,
      id_pipe: true,
      id_holded: true,
      name: true,
      code: true,
      price: true,
    },
  });

  const now = new Date();

  async function processProduct(product: (typeof products)[number]): Promise<HoldedSyncResult> {
    const action: HoldedSyncResult['action'] = product.id_holded ? 'update' : 'create';

    try {
      const payload = product.id_holded ? buildUpdatePayload(product) : buildCreatePayload(product);
      const path = product.id_holded ? `/products/${encodeURIComponent(product.id_holded)}` : '/products';
      const response = await callHoldedApi(path, product.id_holded ? 'PUT' : 'POST', payload);
      const holdedId = product.id_holded ?? extractHoldedId(response.json);

      if (!product.id_holded && holdedId) {
        await prisma.products.update({
          where: { id: product.id },
          data: { id_holded: holdedId, updated_at: now },
        });
      } else {
        await prisma.products.update({
          where: { id: product.id },
          data: { updated_at: now },
        });
      }

      return {
        productId: product.id,
        id_pipe: product.id_pipe,
        name: product.name ?? product.code ?? null,
        action,
        status: 'success',
        message: `Producto ${action === 'create' ? 'creado' : 'actualizado'} correctamente en Holded`,
        holdedId: holdedId ?? null,
      } satisfies HoldedSyncResult;
    } catch (error) {
      console.error('[products-holded-sync] Error procesando producto', product.id_pipe, error);
      return {
        productId: product.id,
        id_pipe: product.id_pipe,
        name: product.name ?? product.code ?? null,
        action,
        status: 'error',
        message: error instanceof Error ? error.message : 'Error inesperado sincronizando con Holded',
        holdedId: product.id_holded ?? null,
      } satisfies HoldedSyncResult;
    }
  }

  const concurrency = Math.min(products.length, 5);
  const results: HoldedSyncResult[] = new Array(products.length);

  // Procesamos en paralelo (máx 5 hilos) para evitar alcanzar el timeout de Netlify
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < products.length) {
      const current = nextIndex++;
      results[current] = await processProduct(products[current]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return successResponse({ results });
});
