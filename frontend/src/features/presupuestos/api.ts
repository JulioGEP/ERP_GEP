// frontend/src/features/presupuestos/api.ts
import type { DealSummary } from '../../types/deal'

/** Error uniforme para el front */
export class ApiError extends Error {
  code: string
  status?: number
  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (typeof err === 'object' && !!err && (err as any).name === 'ApiError')
}

type Json = any
const API_BASE = '/.netlify/functions'

async function request(path: string, init?: RequestInit) {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
    })
  } catch (e: any) {
    throw new ApiError('NETWORK_ERROR', e?.message || 'Fallo de red')
  }

  let data: any = {}
  try { data = await res.json() } catch { /* puede no haber body */ }

  if (!res.ok || data?.ok === false) {
    const code = data?.error_code || `HTTP_${res.status}`
    const msg  = data?.message || 'Error inesperado'
    throw new ApiError(code, msg, res.status)
  }
  return data
}

/* ================= Listado / Detalle / Import ================= */

export async function fetchDealsWithoutSessions(): Promise<DealSummary[]> {
  const data = await request('/deals?noSessions=true')
  const rows = data?.deals || []
  return rows.map((d: Json) => ({
    id: d.deal_id,
    title: d.presupuesto,
    organizationName: d.cliente,
    sede: d.sede,
    training: d.producto
  }))
}

export async function fetchDealDetail(dealId: number | string): Promise<any> {
  const data = await request(`/deals/${encodeURIComponent(String(dealId))}`)
  return data?.deal
}

export async function importDeal(dealId: string): Promise<void> {
  await request('/deals_import', { method: 'POST', body: JSON.stringify({ dealId }) })
}

/* ============ Edición (7 campos) + Comentarios ============ */
/** Tipo independiente para el PATCH de 7 campos (backend espera snake_case en deal_direction). */
export type DealEditablePatch = {
  sede?: string
  hours?: number
  deal_direction?: string
  CAES?: boolean
  FUNDAE?: boolean
  Hotel_Night?: boolean
  alumnos?: number
}

export async function patchDealEditable(
  dealId: string,
  dealPatch: Partial<DealEditablePatch>,
  commentsPatch?: { create?: { content: string; author_name?: string }[]; update?: { comment_id: string; content: string }[] },
  user?: { id: string; name?: string }
): Promise<void> {
  const headers: Record<string,string> = {}
  if (user?.id) headers['X-User-Id'] = user.id
  if (user?.name) headers['X-User-Name'] = user.name

  const body: any = {}
  if (dealPatch && Object.keys(dealPatch).length) body.deal = dealPatch
  if (commentsPatch && ((commentsPatch.create?.length || 0) + (commentsPatch.update?.length || 0) > 0)) {
    body.comments = commentsPatch
  }
  if (!Object.keys(body).length) return

  await request(`/deals/${encodeURIComponent(String(dealId))}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  })
}

/* ================== Documentos (S3 presigned) ================= */

export async function getDocPreviewUrl(dealId: string, docId: string): Promise<string> {
  const data = await request(`/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}/url`)
  return data?.url
}

export async function getUploadUrl(dealId: string, file: File): Promise<{ uploadUrl: string; storageKey: string }> {
  return await request(`/deal_documents/${encodeURIComponent(String(dealId))}/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSize: file.size })
  })
}

export async function createDocumentMeta(
  dealId: string,
  meta: { file_name: string; file_size: number; mime_type?: string; storage_key: string },
  user?: { id: string; name?: string }
): Promise<void> {
  const headers: Record<string,string> = {}
  if (user?.id) headers['X-User-Id'] = user.id
  if (user?.name) headers['X-User-Name'] = user.name

  await request(`/deal_documents/${encodeURIComponent(String(dealId))}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(meta)
  })
}

export async function deleteDocument(dealId: string, docId: string): Promise<void> {
  await request(`/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}`, {
    method: 'DELETE'
  })
}
