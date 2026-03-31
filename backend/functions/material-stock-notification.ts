import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendEmail } from './_shared/mailer';

const LOGISTICS_EMAIL = 'logistica@gepgroup.es';
const SALES_EMAIL = 'sales@gepgroup.es';

type ProductLine = {
  productName: string;
  quantity: number;
};

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function normalizeProducts(input: unknown): ProductLine[] {
  if (!Array.isArray(input)) return [];

  const unique = new Map<string, ProductLine>();

  for (const item of input) {
    const productName = normalizeString((item as { productName?: unknown })?.productName);
    const quantity = normalizePositiveNumber((item as { quantity?: unknown })?.quantity);
    if (!productName || quantity === null) continue;

    const existing = unique.get(productName);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    unique.set(productName, { productName, quantity });
  }

  return Array.from(unique.values());
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const budgetId = normalizeString((request.body as { budgetId?: unknown } | null)?.budgetId);
  const products = normalizeProducts((request.body as { products?: unknown } | null)?.products);
  const shippingAddress = normalizeString((request.body as { shippingAddress?: unknown } | null)?.shippingAddress);
  const contact = normalizeString((request.body as { contact?: unknown } | null)?.contact);

  if (!budgetId) {
    return errorResponse('VALIDATION_ERROR', 'El presupuesto es obligatorio', 400);
  }

  if (!products.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes incluir al menos un producto', 400);
  }

  const productLines = products.map((product) => `- ${product.productName} y la cantidad ${formatQuantity(product.quantity)}`);

  const body = `Hola Logistica\n\nNº de pedido: ${budgetId}\nDesde el Sales necesitamos un nuevo pedido\n${productLines.join(
    '\n',
  )}\n\nDirección de envío: ${shippingAddress ?? 'No informada'}\nContacto: ${contact ?? 'No informado'}\n\nActualizar el pedido cuando tengáis numero de orden o de seguimiento\n\nSino hay Stock y hay que hacer pedido, crearlo desde la ruta https://erpgep.netlify.app/materiales/materiales`;

  await sendEmail({
    to: LOGISTICS_EMAIL,
    cc: SALES_EMAIL,
    subject: `Aviso logística presupuesto ${budgetId}`,
    text: body,
  });

  return successResponse({ sent: true });
});
