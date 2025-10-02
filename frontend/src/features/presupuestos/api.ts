// frontend/src/features/presupuestos/api.ts
import type { DealDetail, DealDetailViewModel, DealProduct, DealSummary } from '../../types/deal'

type Json = any

const API_BASE = '/.netlify/functions'

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

function normalizeProducts(raw: unknown): { products?: DealProduct[]; productNames?: string[] } {
  if (!raw) return {}

  const entries = Array.isArray(raw) ? raw : []
  if (!entries.length) return {}

  const products: DealProduct[] = []
  const names: string[] = []

  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      const item = entry as Record<string, any>
      const quantity = toNumber(item.quantity)
      const product: DealProduct = {
        id: item.id ?? item.product_id ?? null,
        deal_id: item.deal_id ?? null,
        product_id: item.product_id ?? null,
        name: toStringValue(item.name) ?? null,
        code: toStringValue(item.code) ?? null,
        quantity: quantity ?? null
      }
      products.push(product)
      const label = toStringValue(product.name ?? product.code)
      if (label) names.push(label)
    } else {
      const label = toStringValue(entry)
      if (label) names.push(label)
    }
  }

  const result: { products?: DealProduct[]; productNames?: string[] } = {}
  if (products.length) result.products = products
  if (names.length) result.productNames = names
  return result
}

function normalizeDealSummary(row: Json): DealSummary {
  const rawDealId = row?.deal_id ?? row?.dealId ?? row?.id
  const dealNumericId = toNumber(rawDealId)
  const resolvedDealId = toStringValue(rawDealId) ?? (rawDealId != null ? String(rawDealId) : '')
  const explicitTitle = toStringValue(row?.title ?? row?.deal_title)
  const title =
    explicitTitle ??
    (resolvedDealId
      ? `Presupuesto #${resolvedDealId}`
      : dealNumericId != null
        ? `Presupuesto #${dealNumericId}`
        : 'Presupuesto')

  const rawOrganization = row?.organization ?? row?.organizations ?? null
  const organizationName = toStringValue(
    rawOrganization?.name ?? row?.organization_name ?? row?.org_name
  )
  const rawOrgId = rawOrganization?.org_id ?? rawOrganization?.id ?? row?.org_id ?? null
  const organization =
    organizationName !== null || rawOrgId !== null
      ? {
          name: organizationName ?? null,
          org_id: rawOrgId != null ? String(rawOrgId) : null
        }
      : null

  const rawPerson = row?.person ?? null
  const personFirstName = toStringValue(rawPerson?.first_name ?? row?.first_name)
  const personLastName = toStringValue(rawPerson?.last_name ?? row?.last_name)
  const person =
    personFirstName !== null || personLastName !== null
      ? {
          person_id: rawPerson?.person_id ?? rawPerson?.id ?? row?.person_id ?? null,
          first_name: personFirstName ?? null,
          last_name: personLastName ?? null,
          email: rawPerson?.email ?? null,
          phone: rawPerson?.phone ?? null
        }
      : null

  const productsInfo = normalizeProducts(row?.deal_products ?? row?.products)

  const summary: DealSummary = {
    dealId: resolvedDealId,
    dealNumericId: dealNumericId ?? toNumber(resolvedDealId),
    title,
    sede_label: toStringValue(row?.sede_label) ?? null,
    pipeline_id: toStringValue(row?.pipeline_id) ?? null,
    training_address: toStringValue(row?.training_address) ?? null,
    hours: toNumber(row?.hours) ?? null,
    alumnos: toNumber(row?.alumnos) ?? null,
    caes_label: toStringValue(row?.caes_label) ?? null,
    fundae_label: toStringValue(row?.fundae_label) ?? null,
    hotel_label: toStringValue(row?.hotel_label) ?? null,
    prodextra: row?.prodextra ?? null,
    organization,
    person
  }

  if (productsInfo.products) summary.products = productsInfo.products
  if (productsInfo.productNames) summary.productNames = productsInfo.productNames

  return summary
}

function normalizeDealDetail(raw: Json): DealDetail {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('INVALID_DEAL_DETAIL', 'Detalle del presupuesto no disponible')
  }

  const detailId = toStringValue(raw.deal_id ?? raw.id ?? raw.dealId)
  if (!detailId) {
    throw new ApiError('INVALID_DEAL_DETAIL', 'Detalle del presupuesto no disponible')
  }

  const detail: DealDetail = {
    deal_id: detailId,
    title: toStringValue(raw.title ?? raw.deal_title) ?? null,
    pipeline_id: toStringValue(raw.pipeline_id) ?? null,
    training_address: toStringValue(raw.training_address) ?? null,
    sede_label: toStringValue(raw.sede_label) ?? null,
    caes_label: toStringValue(raw.caes_label) ?? null,
    fundae_label: toStringValue(raw.fundae_label) ?? null,
    hotel_label: toStringValue(raw.hotel_label) ?? null,
    hours: toNumber(raw.hours) ?? null,
    alumnos: toNumber(raw.alumnos) ?? null,
    prodextra: raw.prodextra ?? raw.extras ?? null,
    organization: null,
    person: null,
    deal_products: [],
    deal_notes: [],
    documents: undefined,
    comments: undefined
  }

  const rawOrganization = raw.organization ?? raw.organizations ?? null
  const organizationName = toStringValue(
    rawOrganization?.name ?? raw.organization_name ?? raw.org_name
  )
  const rawOrgId = rawOrganization?.org_id ?? rawOrganization?.id ?? raw.org_id ?? null
  if (organizationName !== null || rawOrgId !== null) {
    detail.organization = {
      name: organizationName ?? null,
      org_id: rawOrgId != null ? String(rawOrgId) : null
    }
  }

  const rawPerson = raw.person ?? null
  const personFirstName = toStringValue(rawPerson?.first_name ?? raw.first_name)
  const personLastName = toStringValue(rawPerson?.last_name ?? raw.last_name)
  if (personFirstName !== null || personLastName !== null) {
    detail.person = {
      person_id: rawPerson?.person_id ?? rawPerson?.id ?? raw.person_id ?? null,
      first_name: personFirstName ?? null,
      last_name: personLastName ?? null,
      email: rawPerson?.email ?? null,
      phone: rawPerson?.phone ?? null
    }
  }

  const productsInfo = normalizeProducts(raw.deal_products ?? raw.products)
  detail.deal_products = productsInfo.products ?? []

  if (Array.isArray(raw.deal_notes)) {
    detail.deal_notes = raw.deal_notes.map((note: any) => ({
      id: note.id ?? note.notes_id ?? null,
      deal_id: note.deal_id ?? null,
      content: toStringValue(note.content ?? note.comment_deal) ?? null,
      author: toStringValue(note.author) ?? null,
      created_at: toStringValue(note.created_at) ?? null
    }))
  } else {
    detail.deal_notes = []
  }

  if (Array.isArray(raw.comments)) {
    detail.comments = raw.comments.map((comment: any) => ({
      id: comment.id ?? comment.comment_id,
      comment_id: comment.comment_id ?? comment.id,
      authorId: comment.authorId ?? comment.author_id,
      author_id: comment.author_id ?? comment.authorId,
      authorName: comment.authorName ?? comment.author_name ?? null,
      content: comment.content ?? null,
      createdAt: comment.createdAt ?? comment.created_at ?? null,
      created_at: comment.created_at ?? comment.createdAt ?? null
    }))
  }

  if (Array.isArray(raw.documents)) {
    detail.documents = raw.documents.map((doc: any) => ({
      id: doc.id ?? doc.doc_id,
      doc_id: doc.doc_id ?? doc.id,
      fileName: doc.fileName ?? doc.file_name,
      file_name: doc.file_name ?? doc.fileName,
      fileSize: toNumber(doc.fileSize ?? doc.file_size) ?? null,
      file_size: toNumber(doc.file_size ?? doc.fileSize) ?? null,
      mimeType: doc.mimeType ?? doc.mime_type ?? null,
      mime_type: doc.mime_type ?? doc.mimeType ?? null,
      storageKey: doc.storageKey ?? doc.storage_key ?? null,
      storage_key: doc.storage_key ?? doc.storageKey ?? null,
      origin: doc.origin ?? null
    }))
  }

  return detail
}

function pickNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length) return trimmed
    }
  }
  return null
}

function buildPersonFullName(person?: { first_name?: string | null; last_name?: string | null } | null): string | null {
  if (!person) return null
  const parts = [person.first_name, person.last_name]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
  return parts.length ? parts.join(' ') : null
}

function resolveProducts(detail?: DealDetail | null, summary?: DealSummary | null): DealProduct[] {
  if (detail && Array.isArray(detail.deal_products) && detail.deal_products.length) {
    return detail.deal_products.filter((product): product is DealProduct => Boolean(product))
  }

  if (summary && Array.isArray(summary.products) && summary.products.length) {
    return summary.products.filter((product): product is DealProduct => Boolean(product))
  }

  return []
}

function resolveProductName(detail?: DealDetail | null, summary?: DealSummary | null): string | null {
  const products = resolveProducts(detail, summary)
  for (const product of products) {
    const label = pickNonEmptyString(product?.name ?? null, product?.code ?? null)
    if (label) return label
  }

  if (Array.isArray(summary?.productNames)) {
    const label = pickNonEmptyString(...summary.productNames)
    if (label) return label
  }

  return null
}

export function buildDealDetailViewModel(
  detail?: DealDetail | null,
  summary?: DealSummary | null
): DealDetailViewModel {
  const dealId = pickNonEmptyString(
    detail?.deal_id,
    summary?.dealId,
    summary?.dealNumericId != null ? String(summary.dealNumericId) : undefined
  )

  const title = pickNonEmptyString(detail?.title ?? null, summary?.title ?? null)
  const organizationName = pickNonEmptyString(
    detail?.organization?.name ?? null,
    summary?.organization?.name ?? null
  )
  const clientName = buildPersonFullName(detail?.person ?? summary?.person ?? null)
  const pipelineLabel = pickNonEmptyString(detail?.pipeline_id ?? null, summary?.pipeline_id ?? null)
  const trainingAddress = pickNonEmptyString(
    detail?.training_address ?? null,
    summary?.training_address ?? null
  )
  const productName = resolveProductName(detail ?? null, summary ?? null)

  const hours = detail?.hours ?? summary?.hours ?? null
  const alumnos = detail?.alumnos ?? summary?.alumnos ?? null
  const sedeLabel = pickNonEmptyString(detail?.sede_label ?? null, summary?.sede_label ?? null)
  const caesLabel = pickNonEmptyString(detail?.caes_label ?? null, summary?.caes_label ?? null)
  const fundaeLabel = pickNonEmptyString(detail?.fundae_label ?? null, summary?.fundae_label ?? null)
  const hotelLabel = pickNonEmptyString(detail?.hotel_label ?? null, summary?.hotel_label ?? null)
  const extras = detail?.prodextra ?? summary?.prodextra ?? null

  const notes = (detail?.deal_notes ?? []).map((note) => ({
    id: note?.id ?? null,
    content: pickNonEmptyString(note?.content ?? null) ?? '',
    author: pickNonEmptyString(note?.author ?? null)
  }))

  return {
    dealId: dealId ?? '',
    title: title ?? null,
    organizationName: organizationName ?? null,
    clientName: clientName ?? null,
    pipelineLabel: pipelineLabel ?? null,
    trainingAddress: trainingAddress ?? null,
    productName: productName ?? null,
    hours,
    alumnos,
    sedeLabel: sedeLabel ?? null,
    caesLabel: caesLabel ?? null,
    fundaeLabel: fundaeLabel ?? null,
    hotelLabel: hotelLabel ?? null,
    extras,
    products: resolveProducts(detail, summary),
    notes
  }
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

export async function fetchDealDetail(dealId: number | string): Promise<DealDetail> {
  const data = await request(`/deals/${encodeURIComponent(String(dealId))}`)
  return normalizeDealDetail(data?.deal)
}

export async function importDeal(dealId: string): Promise<DealSummary | null> {
  // FIX CTO: el backend expone '/deals/import' (no '/deals_import')
  const data = await request('/deals/import', { method: 'POST', body: JSON.stringify({ dealId }) })
  const importedId = data?.deal_id ?? data?.dealId ?? data?.id ?? dealId
  if (!importedId) return null

  const summaries = await fetchDealsWithoutSessions()
  const summary = summaries.find((item) => String(item.dealId) === String(importedId))
  return summary ?? null
}

/* ============ Edición (7 campos) + Comentarios ============ */
/** Tipo independiente para el PATCH de 7 campos con nombres de columnas actuales. */
export type DealEditablePatch = {
  sede_label?: string | null
  hours?: number | null
  training_address?: string | null
  caes_label?: string | null
  fundae_label?: string | null
  hotel_label?: string | null
  alumnos?: number | null
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
