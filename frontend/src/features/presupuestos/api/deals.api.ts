import { requestJson } from '../../../api/client';
import {
  ApiError,
  buildPersonFullName,
  normalizeDealDetail,
  normalizeDealNote,
  normalizeDealSummary,
  normalizeNoteContent,
  pickNonEmptyString,
  toNumber,
  toStringValue,
} from './shared';
import type {
  DealDetail,
  DealDetailViewModel,
  DealDocument,
  DealNote,
  DealProduct,
  DealSummary,
  Json,
} from './types';

export type ImportDealResult = { warnings: string[]; deal: DealDetail };

export async function fetchDealsWithoutSessions(): Promise<DealSummary[]> {
  const data = await requestJson<{ deals?: Json[] }>(`/deals?noSessions=true`);
  const rows: Json[] = Array.isArray(data?.deals) ? data.deals : [];
  return rows.map((row) => normalizeDealSummary(row));
}

export async function fetchDealsWithPendingCertificates(): Promise<DealSummary[]> {
  const data = await requestJson<{ deals?: Json[] }>(`/deals?pendingCertificates=true`);
  const rows: Json[] = Array.isArray(data?.deals) ? data.deals : [];
  return rows.map((row) => normalizeDealSummary(row));
}

export async function fetchDealDetail(dealId: number | string): Promise<DealDetail> {
  const data = await requestJson<{ deal?: Json }>(`/deals?dealId=${encodeURIComponent(String(dealId))}`);
  return normalizeDealDetail(data?.deal ?? {});
}

export async function importDeal(dealId: string): Promise<ImportDealResult> {
  const data = await requestJson<{ warnings?: unknown[]; deal?: Json }>(`/deals/import`, {
    method: 'POST',
    body: JSON.stringify({ dealId }),
  });

  const warnings: string[] = Array.isArray(data?.warnings)
    ? data.warnings.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const deal: DealDetail = normalizeDealDetail(data?.deal ?? {});
  return { warnings, deal };
}

export async function deleteDeal(dealId: string): Promise<void> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'Falta dealId para eliminar el presupuesto');
  }

  await requestJson(`/deals/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
  });
}

export type DealEditablePatch = {
  sede_label?: string | null;
  hours?: number | null;
  training_address?: string | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  comercial?: string | null;
  w_id_variation?: string | null;
  a_fecha?: string | null;
};

export type DealProductEditablePatch = {
  id: string;
  hours?: number | null;
  comments?: string | null;
};

export async function patchDealEditable(
  dealId: string,
  dealPatch: Partial<DealEditablePatch>,
  user?: { id: string; name?: string },
  options?: { products?: DealProductEditablePatch[] },
): Promise<void> {
  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const sanitizedDealPatch = dealPatch
    ? (Object.fromEntries(
        Object.entries(dealPatch).filter(([, value]) => value !== undefined),
      ) as Partial<DealEditablePatch>)
    : null;
  const hasDealPatch = !!sanitizedDealPatch && Object.keys(sanitizedDealPatch).length > 0;

  const sanitizedProductPatch: DealProductEditablePatch[] = Array.isArray(options?.products)
    ? options!.products
        .map((product) => {
          if (!product || typeof product !== 'object') return null;
          const id = 'id' in product ? String(product.id).trim() : '';
          if (!id) return null;

          const entry: DealProductEditablePatch = { id };
          if (Object.prototype.hasOwnProperty.call(product, 'hours')) {
            entry.hours = product.hours ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(product, 'comments')) {
            entry.comments = product.comments ?? null;
          }

          return Object.keys(entry).length > 1 ? entry : null;
        })
        .filter((entry): entry is DealProductEditablePatch => entry !== null)
    : [];

  if (!hasDealPatch && !sanitizedProductPatch.length) return;

  const body: Record<string, unknown> = {};
  if (hasDealPatch && sanitizedDealPatch) body.deal = sanitizedDealPatch;
  if (sanitizedProductPatch.length) body.products = sanitizedProductPatch;

  await requestJson(`/deals/${encodeURIComponent(String(dealId))}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

export async function createDealNote(
  dealId: string,
  content: string,
  user?: { id: string; name?: string },
): Promise<DealNote> {
  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const data = await requestJson<{ note?: Json }>(`/deal_notes/${encodeURIComponent(String(dealId))}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
  });

  return normalizeDealNote(data?.note ?? {});
}

export async function updateDealNote(
  dealId: string,
  noteId: string,
  content: string,
  user?: { id: string; name?: string },
): Promise<DealNote> {
  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const data = await requestJson<{ note?: Json }>(
    `/deal_notes/${encodeURIComponent(String(dealId))}/${encodeURIComponent(String(noteId))}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ content }),
    },
  );

  return normalizeDealNote(data?.note ?? {});
}

export async function deleteDealNote(
  dealId: string,
  noteId: string,
  user?: { id: string; name?: string },
): Promise<void> {
  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  await requestJson(
    `/deal_notes/${encodeURIComponent(String(dealId))}/${encodeURIComponent(String(noteId))}`,
    {
      method: 'DELETE',
      headers,
    },
  );
}

function resolveProducts(detail?: DealDetail | null, summary?: DealSummary | null): DealProduct[] {
  if (detail?.products?.length) return detail.products;
  if (summary?.products?.length) return summary.products;
  return [];
}

function resolveProductName(detail?: DealDetail | null, summary?: DealSummary | null): string | null {
  const products = resolveProducts(detail, summary);
  for (const product of products) {
    const label = pickNonEmptyString(product?.name ?? null, product?.code ?? null);
    if (label) return label;
  }
  if (Array.isArray(summary?.productNames)) {
    const label = pickNonEmptyString(...summary!.productNames);
    if (label) return label;
  }
  return null;
}

export function buildDealDetailViewModel(
  detail?: DealDetail | null,
  summary?: DealSummary | null,
): DealDetailViewModel {
  const dealId = pickNonEmptyString(detail?.deal_id, summary?.deal_id, summary?.dealId);

  const title = pickNonEmptyString(detail?.title ?? null, summary?.title ?? null);
  const organizationName = pickNonEmptyString(
    detail?.organization?.name ?? null,
    summary?.organization?.name ?? null,
  );
  const person = detail?.person ?? summary?.person ?? null;
  const clientName = buildPersonFullName(person ?? null);
  const clientEmail = pickNonEmptyString(person?.email ?? null);
  const clientPhone = pickNonEmptyString(person?.phone ?? null);

  const pipelineLabel = pickNonEmptyString(
    detail?.pipeline_label ?? null,
    summary?.pipeline_label ?? null,
  );
  const trainingAddress = pickNonEmptyString(
    detail?.training_address ?? null,
    summary?.training_address ?? null,
  );

  const productName = resolveProductName(detail ?? null, summary ?? null);

  const hours = detail?.hours ?? summary?.hours ?? null;
  const sedeLabel = pickNonEmptyString(detail?.sede_label ?? null, summary?.sede_label ?? null);
  const caesLabel = pickNonEmptyString(detail?.caes_label ?? null, summary?.caes_label ?? null);
  const fundaeLabel = pickNonEmptyString(detail?.fundae_label ?? null, summary?.fundae_label ?? null);
  const hotelLabel = pickNonEmptyString(detail?.hotel_label ?? null, summary?.hotel_label ?? null);
  const comercial = pickNonEmptyString(detail?.comercial ?? null, summary?.comercial ?? null);
  const aFecha = pickNonEmptyString(detail?.a_fecha ?? null, summary?.a_fecha ?? null);
  const wIdVariation = pickNonEmptyString(
    detail?.w_id_variation ?? null,
    summary?.w_id_variation ?? null,
  );
  const presuHolded = pickNonEmptyString(
    detail?.presu_holded ?? null,
    summary?.presu_holded ?? null,
  );
  const modoReserva = pickNonEmptyString(detail?.modo_reserva ?? null, summary?.modo_reserva ?? null);

  return {
    dealId: dealId ?? '',
    title: title ?? null,
    organizationName: organizationName ?? null,
    clientName: clientName ?? null,
    clientEmail: clientEmail ?? null,
    clientPhone: clientPhone ?? null,
    pipelineLabel: pipelineLabel ?? null,
    trainingAddress: trainingAddress ?? null,
    productName: productName ?? null,
    hours,
    sedeLabel: sedeLabel ?? null,
    caesLabel: caesLabel ?? null,
    fundaeLabel: fundaeLabel ?? null,
    hotelLabel: hotelLabel ?? null,
    comercial: comercial ?? null,
    aFecha: aFecha ?? null,
    wIdVariation: wIdVariation ?? null,
    presuHolded,
    modoReserva: modoReserva ?? null,
    extras: undefined,
    products: resolveProducts(detail, summary),
    notes: (detail?.notes ?? []).map((n) => ({
      id: n?.id ?? null,
      content: normalizeNoteContent(n?.content ?? null),
      author: pickNonEmptyString(n?.author ?? null),
    })),
  };
}
