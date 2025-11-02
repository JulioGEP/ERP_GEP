import type {
  DealDetail,
  DealDetailViewModel,
  DealProduct,
  DealSummary,
  DealSummarySession,
  DealDocument,
  DealNote,
} from '../../../types/deal';
import { ApiError, requestJson, toStringValue } from '../../../api/client';
import { splitFilterValue } from '../../../components/table/filterUtils';
import { blobOrFileToBase64 } from '../../../utils/base64';
import {
  buildDealDetailViewModel,
  normalizeDealDetail,
  normalizeDealDocument,
  normalizeDealNote,
  normalizeDealSummary,
} from './normalizers';
import { SESSION_ESTADOS, type SessionEstado } from '../../../api/sessions.types';

export type ImportDealResult = { warnings: string[]; deal: DealDetail };

export type DealEditablePatch = {
  sede_label?: string | null;
  hours?: number | null;
  training_address?: string | null;
  caes_label?: string | null;
  caes_val?: boolean;
  fundae_label?: string | null;
  fundae_val?: boolean;
  hotel_label?: string | null;
  hotel_val?: boolean;
  transporte_val?: boolean;
  po_val?: boolean;
  comercial?: string | null;
  w_id_variation?: string | null;
  a_fecha?: string | null;
};

export type DealProductEditablePatch = {
  id: string;
  hours?: number | null;
  comments?: string | null;
};

async function request<T = any>(path: string, init?: RequestInit) {
  return requestJson<T>(path, init);
}

export type DealsListSort = { id: string; desc?: boolean };
export type DealsListOptions = {
  filters?: Record<string, string>;
  search?: string;
  sorting?: DealsListSort[];
};

export type DealsWithoutSessionsSort = DealsListSort;
export type DealsWithoutSessionsOptions = DealsListOptions;

function buildDealsQuery(
  options?: DealsListOptions,
  extraParams?: Record<string, string>,
): string {
  const searchParams = new URLSearchParams();

  if (extraParams) {
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, value);
      }
    });
  }

  if (options?.search && options.search.trim().length) {
    searchParams.set('search', options.search.trim());
  }

  if (options?.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      const parts = splitFilterValue(value);
      if (!parts.length) return;
      parts.forEach((part) => {
        const normalizedValue = part.trim();
        if (!normalizedValue.length) return;
        const serverValue = normalizeFilterValueForRequest(key, normalizedValue);
        if (!serverValue) return;
        searchParams.append(`filter[${key}]`, serverValue);
      });
    });
  }

  if (options?.sorting && options.sorting.length) {
    const sortValue = options.sorting
      .filter((item) => item.id)
      .map((item) => `${item.desc ? '-' : ''}${item.id}`)
      .join(',');
    if (sortValue.length) {
      searchParams.set('sort', sortValue);
    }
  }

  const query = searchParams.toString();
  return query;
}

function normalizeFilterValueForRequest(key: string, value: string): string | null {
  if (key === 'session_state') {
    return toSessionEstadoRequestValue(value);
  }
  return value.trim().length ? value : null;
}

function toSessionEstadoRequestValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.length) return null;
  const upper = trimmed.toUpperCase();
  if (!SESSION_ESTADOS.includes(upper as SessionEstado)) {
    return trimmed;
  }
  const lower = upper.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

async function fetchDealsWithParams(
  options?: DealsListOptions,
  extraParams?: Record<string, string>,
): Promise<DealSummary[]> {
  const query = buildDealsQuery(options, extraParams);
  const path = query.length ? `/deals?${query}` : '/deals';
  const data = await request<{ deals?: unknown[] }>(path);
  const rows: unknown[] = Array.isArray(data?.deals) ? data.deals ?? [] : [];
  return rows.map((row) => normalizeDealSummary(row));
}

export async function fetchDeals(options?: DealsListOptions): Promise<DealSummary[]> {
  return fetchDealsWithParams(options);
}

export async function fetchDealsWithoutSessions(
  options?: DealsWithoutSessionsOptions,
): Promise<DealSummary[]> {
  return fetchDealsWithParams(options, { noSessions: 'true' });
}

export async function fetchDealsWithPendingCertificates(): Promise<DealSummary[]> {
  const data = await request<{ deals?: unknown[] }>('/deals?pendingCertificates=true');
  const rows: unknown[] = Array.isArray(data?.deals) ? data.deals ?? [] : [];
  return rows.map((row) => normalizeDealSummary(row));
}

export async function fetchDealDetail(dealId: number | string): Promise<DealDetail> {
  const data = await request<{ deal?: unknown }>(
    `/deals?dealId=${encodeURIComponent(String(dealId))}`,
  );
  return normalizeDealDetail(data?.deal ?? {});
}

export async function importDeal(dealId: string): Promise<ImportDealResult> {
  const data = await request<{ warnings?: unknown[]; deal?: unknown }>('/deals/import', {
    method: 'POST',
    body: JSON.stringify({ dealId }),
  });

  const warnings: string[] = Array.isArray(data?.warnings) ? (data.warnings as string[]) : [];
  const deal: DealDetail = normalizeDealDetail(data?.deal ?? {});
  return { warnings, deal };
}

export async function deleteDeal(dealId: string): Promise<void> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'Falta dealId para eliminar el presupuesto');
  }

  await request(`/deals/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
  });
}

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
  if (hasDealPatch && sanitizedDealPatch) body.deals = sanitizedDealPatch;
  if (sanitizedProductPatch.length) body.products = sanitizedProductPatch;

  await request(`/deals/${encodeURIComponent(String(dealId))}`, {
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

  const data = await request<{ note?: unknown }>(`/deal_notes/${encodeURIComponent(String(dealId))}`, {
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

  const data = await request<{ note?: unknown }>(
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

  await request(
    `/deal_notes/${encodeURIComponent(String(dealId))}/${encodeURIComponent(String(noteId))}`,
    {
      method: 'DELETE',
      headers,
    },
  );
}

export async function listDocuments(dealId: string): Promise<DealDocument[]> {
  const data = await request<{ documents?: unknown[] }>(
    `/deal_documents/${encodeURIComponent(String(dealId))}`,
  );
  const docs: unknown[] = Array.isArray(data?.documents) ? data.documents ?? [] : [];
  return docs.map((doc) => normalizeDealDocument(doc));
}

export async function getDocPreviewUrl(
  dealId: string,
  docId: string,
): Promise<{ url: string; name?: string | null; mime_type?: string | null }> {
  const data = await request<{ url?: unknown; name?: unknown; mime_type?: unknown }>(
    `/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}/url`,
  );
  return {
    url: String(data?.url ?? ''),
    name: toStringValue(data?.name),
    mime_type: toStringValue(data?.mime_type),
  };
}

const MANUAL_INLINE_UPLOAD_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
const MANUAL_INLINE_UPLOAD_MAX_LABEL = '4.5 MB';
export const MANUAL_DOCUMENT_SIZE_LIMIT_BYTES = MANUAL_INLINE_UPLOAD_MAX_BYTES;
export const MANUAL_DOCUMENT_SIZE_LIMIT_LABEL = MANUAL_INLINE_UPLOAD_MAX_LABEL;
export const MANUAL_DOCUMENT_SIZE_LIMIT_MESSAGE = `Archivo demasiado pesado, máximo ${MANUAL_DOCUMENT_SIZE_LIMIT_LABEL}`;

async function prepareDealDocumentUpload(
  dealId: string,
  file: File,
  headers: Record<string, string>,
): Promise<{ uploadUrl: string; storageKey: string }> {
  const payload = await request<{ uploadUrl?: unknown; storageKey?: unknown }>(
    `/deal_documents/${encodeURIComponent(dealId)}/upload-url`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      }),
    },
  );

  const uploadUrl = toStringValue(payload?.uploadUrl);
  const storageKey = toStringValue(payload?.storageKey);
  if (!uploadUrl || !storageKey) {
    throw new ApiError('UPLOAD_PREPARE_ERROR', 'No se pudo preparar la subida del documento');
  }

  return { uploadUrl, storageKey };
}

async function uploadFileToUrl(uploadUrl: string, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
  } catch (error: any) {
    throw new ApiError('NETWORK_ERROR', error?.message || 'Fallo de red al subir el documento');
  }

  if (!response.ok) {
    throw new ApiError(
      'UPLOAD_ERROR',
      'No se pudo subir el documento al almacenamiento',
      response.status,
    );
  }
}

export async function uploadManualDocument(
  dealId: string,
  file: File,
  user?: { id: string; name?: string },
): Promise<void> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'Falta dealId para subir el documento');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  if (file.size > MANUAL_INLINE_UPLOAD_MAX_BYTES) {
    try {
      const { uploadUrl, storageKey } = await prepareDealDocumentUpload(normalizedId, file, headers);
      await uploadFileToUrl(uploadUrl, file);

      await request(`/deal_documents/${encodeURIComponent(normalizedId)}/manual`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          storageKey,
        }),
      });
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
    }
  }

  const base64 = await blobOrFileToBase64(file);
  await request(`/deal_documents/${encodeURIComponent(normalizedId)}/manual`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      contentBase64: base64,
    }),
  });
}

export async function deleteDocument(dealId: string, docId: string): Promise<void> {
  await request(
    `/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}`,
    { method: 'DELETE' },
  );
}

export { buildDealDetailViewModel };
export type { DealDetail, DealDetailViewModel, DealSummary, DealProduct, DealSummarySession, DealDocument, DealNote };
