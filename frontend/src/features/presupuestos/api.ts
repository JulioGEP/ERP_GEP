// frontend/src/features/presupuestos/api.ts
import type { DealSummary } from '../../types/deal'

type Json = any

const API_BASE = '/.netlify/functions'

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str.length ? str : null
}

function normalizeTraining(raw: unknown): { training?: DealSummary['training']; trainingNames?: string[] } {
  if (!raw) return {}
  if (Array.isArray(raw)) {
    if (!raw.length) return {}
    const training = raw as DealSummary['training']
    const names = raw
      .map((entry) => {
        if (entry && typeof entry === 'object' && 'name' in entry && entry.name) return String(entry.name)
        if (entry && typeof entry === 'object' && 'code' in entry && entry.code) return String(entry.code)
        return toStringValue(entry)
      })
      .filter((value): value is string => Boolean(value))

    return {
      training,
      trainingNames: names.length ? names : undefined
    }
  }

  const label = toStringValue(raw)
  if (!label) return {}

  return { trainingNames: [label] }
}

function normalizeDealSummary(row: Json): DealSummary {
  const rawDealId = row?.deal_id ?? row?.dealId ?? row?.id
  const dealNumericId = toNumber(rawDealId)
  const dealIdString = toStringValue(rawDealId) ?? (rawDealId != null ? String(rawDealId) : '')
  const dealOrgId = toNumber(row?.org_id ?? row?.deal_org_id ?? row?.organizationId ?? row?.orgId)
  const explicitTitle = toStringValue(row?.title ?? row?.deal_title)
  const presupuestoLabel = toStringValue(row?.presupuesto ?? row?.budget)
  const resolvedDealId =
    dealIdString || presupuestoLabel || (dealNumericId != null ? String(dealNumericId) : '')
  const title =
    explicitTitle ??
    presupuestoLabel ??
    (resolvedDealId
      ? `Presupuesto #${resolvedDealId}`
      : dealNumericId != null
        ? `Presupuesto #${dealNumericId}`
        : 'Presupuesto')

  const organizationName =
    toStringValue(
      row?.org_name ??
        row?.organizationName ??
        row?.organization_name ??
        row?.cliente ??
        row?.clientName ??
        row?.organization?.name
    ) ?? ''

  const sede =
    toStringValue(
      row?.['676d6bd51e52999c582c01f67c99a35ed30bf6ae'] ?? row?.sede ?? row?.site ?? row?.location
    ) ?? ''
  const trainingInfo = normalizeTraining(
    row?.training ?? row?.trainingNames ?? row?.training_names ?? row?.producto ?? row?.product
  )

  const summary: DealSummary = {
    dealId: resolvedDealId,
    dealNumericId: dealNumericId ?? toNumber(resolvedDealId),
    dealOrgId:
      dealOrgId ??
      toNumber(row?.deal_org_id ?? row?.organizationId ?? row?.orgId ?? null) ??
      null,
    organizationName,
    clientName: toStringValue(row?.clientName ?? row?.cliente) ?? organizationName,
    title,
    sede,
    trainingType: toStringValue(row?.trainingType ?? row?.training_type ?? row?.pipeline) ?? undefined,
    hours: toNumber(row?.hours) ?? undefined,
    dealDirection: toStringValue(row?.deal_direction ?? row?.dealDirection ?? row?.direction) ?? undefined,
    caes: toStringValue(row?.caes ?? row?.CAES) ?? undefined,
    fundae: toStringValue(row?.fundae ?? row?.FUNDAE) ?? undefined,
    hotelNight: toStringValue(row?.hotelNight ?? row?.Hotel_Night) ?? undefined,
    alumnos: toNumber(row?.alumnos) ?? undefined,
    documentsNum: toNumber(row?.documentsNum ?? row?.documents_num) ?? undefined,
    notesCount: toNumber(row?.notesCount ?? row?.notes_num) ?? undefined,
    createdAt: toStringValue(row?.createdAt ?? row?.created_at) ?? undefined,
    updatedAt: toStringValue(row?.updatedAt ?? row?.updated_at) ?? undefined
  }

  if ('training' in trainingInfo && trainingInfo.training) {
    summary.training = trainingInfo.training
  }
  if (trainingInfo.trainingNames) {
    summary.trainingNames = trainingInfo.trainingNames
  }

  if (Array.isArray(row?.prodExtra)) summary.prodExtra = row.prodExtra
  if (Array.isArray(row?.prodExtraNames)) summary.prodExtraNames = row.prodExtraNames
  if (Array.isArray(row?.documents)) summary.documents = row.documents
  if (Array.isArray(row?.documentsUrls)) summary.documentsUrls = row.documentsUrls
  if (Array.isArray(row?.notes)) summary.notes = row.notes
  if (Array.isArray(row?.participants)) summary.participants = row.participants

  return summary
}

function normalizeDealDetail(raw: Json) {
  if (!raw || typeof raw !== 'object') return raw

  const deal: Record<string, any> = { ...raw }
  const id = raw.id ?? raw.deal_id ?? raw.dealId
  if (id !== undefined && id !== null) {
    const numericId = toNumber(id)
    deal.id = numericId ?? id
    deal.deal_id = raw.deal_id ?? numericId ?? id
  }

  if (deal.deal_title === undefined && raw.title !== undefined) deal.deal_title = raw.title
  if (deal.title === undefined && raw.deal_title !== undefined) deal.title = raw.deal_title

  if (!deal.organization && raw.organization_name) {
    deal.organization = { name: raw.organization_name }
  }

  if (raw.organization && typeof raw.organization === 'object') {
    deal.organization = {
      ...raw.organization,
      id: raw.organization.id ?? raw.organization.org_id ?? raw.org_id ?? deal.organization?.id ?? null,
      name:
        raw.organization.name ??
        raw.organizationName ??
        raw.organization.name ??
        raw.org_name ??
        deal.organization?.name ??
        null
    }
  }

  if (Array.isArray(raw.comments)) {
    deal.comments = raw.comments.map((comment: any) => ({
      ...comment,
      id: comment.id ?? comment.comment_id,
      comment_id: comment.comment_id ?? comment.id,
      authorId: comment.authorId ?? comment.author_id,
      author_id: comment.author_id ?? comment.authorId,
      createdAt: comment.createdAt ?? comment.created_at,
      created_at: comment.created_at ?? comment.createdAt
    }))
  }

  if (Array.isArray(raw.documents)) {
    deal.documents = raw.documents.map((doc: any) => ({
      ...doc,
      id: doc.id ?? doc.doc_id,
      doc_id: doc.doc_id ?? doc.id,
      fileName: doc.fileName ?? doc.file_name,
      file_name: doc.file_name ?? doc.fileName,
      fileSize: doc.fileSize ?? doc.file_size,
      file_size: doc.file_size ?? doc.fileSize,
      mimeType: doc.mimeType ?? doc.mime_type,
      mime_type: doc.mime_type ?? doc.mimeType,
      storageKey: doc.storageKey ?? doc.storage_key,
      storage_key: doc.storage_key ?? doc.storageKey
    }))
  }

  return deal
}

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
  const rows: Json[] = Array.isArray(data?.deals) ? data.deals : []
  return rows.map((row) => normalizeDealSummary(row))
}

export async function fetchDealDetail(dealId: number | string): Promise<any> {
  const data = await request(`/deals/${encodeURIComponent(String(dealId))}`)
  return normalizeDealDetail(data?.deal)
}

export async function importDeal(dealId: string): Promise<DealSummary | null> {
  const data = await request('/deals_import', { method: 'POST', body: JSON.stringify({ dealId }) })
  const importedId = data?.deal_id ?? data?.dealId ?? data?.id ?? dealId
  if (!importedId) return null

  const summaries = await fetchDealsWithoutSessions()
  const summary = summaries.find((item) => String(item.dealId) === String(importedId))
  return summary ?? null
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
