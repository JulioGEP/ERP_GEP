/* netlify/functions/deals.ts
 * Endpoints soportados:
 *  - GET    /.netlify/functions/deals?noSessions=true
 *  - GET    /.netlify/functions/deals/:dealId
 *  - POST   /.netlify/functions/deals/import  { dealId }
 *  - PATCH  /.netlify/functions/deals/:dealId (campos editables + comments)
 *
 * NOTAS CTO:
 * - Todas las IDs externas (deal_id, org_id, person_id, product_id, stage_id, pipeline_id)
 *   se FUERZAN A STRING antes de persistir.
 * - Corrige el error:
 *   "Invalid value provided. Expected String, provided Int." en organizations.upsert
 */

import type { Handler } from '@netlify/functions'
import fetch from 'node-fetch'
import { PrismaClient } from '@prisma/client'

const prisma2 = new PrismaClient()

// ---- Utils ----------------------------------------------------

const ok = (data: unknown, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

const fail = (code: string, message: string, status = 500, extra?: any) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ok: false, error_code: code, message, ... (extra ?? {}) }),
})

const toStr = (v: any): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length ? s : null
}
const toNum = (v: any): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

const ENV = {
  PIPEDRIVE_BASE_URL: process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1',
  PIPEDRIVE_API_TOKEN: process.env.PIPEDRIVE_API_TOKEN || '',
}

// Campos permitidos en PATCH (con naming vigente de la app)
const EDITABLE_FIELDS = new Set([
  'sede_label',
  'hours',
  'training_address',
  'caes_label',
  'fundae_label',
  'hotel_label',
  'alumnos',
])

// ---- Pipedrive ------------------------------------------------

async function pdRequest(path: string) {
  if (!ENV.PIPEDRIVE_API_TOKEN) {
    throw new Error('PIPEDRIVE_API_TOKEN no configurado')
  }
  const url = `${ENV.PIPEDRIVE_BASE_URL}${path}${path.includes('?') ? '&' : '?'}api_token=${ENV.PIPEDRIVE_API_TOKEN}`
  const res = await fetch(url)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Pipedrive ${res.status}: ${txt}`)
  }
  const json = await res.json()
  return json?.data ?? json
}

async function fetchDealFromPipedrive(dealId: string) {
  const deal = await pdRequest(`/deals/${encodeURIComponent(dealId)}`)
  // productos (deals/{id}/products), notas, persona, organización
  let products: any[] = []
  try {
    const pr = await pdRequest(`/deals/${encodeURIComponent(dealId)}/products`)
    products = Array.isArray(pr) ? pr : (pr?.items ?? [])
  } catch {}
  let org: any = null
  if (deal?.org_id) {
    try { org = await pdRequest(`/organizations/${encodeURIComponent(deal.org_id)}`) } catch {}
  }
  let person: any = null
  if (deal?.person_id) {
    try { person = await pdRequest(`/persons/${encodeURIComponent(deal.person_id)}`) } catch {}
  }
  return { deal, org, person, products }
}

// ---- Normalización --------------------------------------------

type Normalized = {
  deal_id: string
  title: string | null
  pipeline_id: string | null
  stage_id: string | null
  org_id: string | null
  org_name: string | null
  person_id: string | null
  person_first_name: string | null
  person_last_name: string | null
  person_email: string | null
  person_phone: string | null
  // labels/valores que ya lee el front:
  sede_label: string | null
  training_address: string | null
  hours: number | null
  alumnos: number | null
  caes_label: string | null
  fundae_label: string | null
  hotel_label: string | null
  prodextra: any
  products: Array<{ product_id: string | null; name: string | null; code: string | null; quantity: number | null }>
}

function normalizeFromPD(input: any): Normalized {
  const d = input?.deal ?? input

  const org_id = toStr(d?.org_id)
  const person_id = toStr(d?.person_id)

  const pipeline_id = toStr(d?.pipeline_id)
  const stage_id = toStr(d?.stage_id)

  // Campos propios del ERP (labels) – si vienen en PD via custom fields, mapea aquí
  const sede_label = toStr(d?.sede_label ?? d?.cf_sede_label)
  const training_address = toStr(d?.training_address ?? d?.cf_training_address)
  const hours = toNum(d?.hours ?? d?.cf_hours)
  const alumnos = toNum(d?.alumnos ?? d?.cf_alumnos)
  const caes_label = toStr(d?.caes_label ?? d?.cf_caes_label)
  const fundae_label = toStr(d?.fundae_label ?? d?.cf_fundae_label)
  const hotel_label = toStr(d?.hotel_label ?? d?.cf_hotel_label)

  const prodextra = d?.prodextra ?? null

  const productsRaw = input?.products ?? []
  const products = (Array.isArray(productsRaw) ? productsRaw : []).map((p: any) => ({
    product_id: toStr(p?.product_id ?? p?.id),
    name: toStr(p?.name),
    code: toStr(p?.code),
    quantity: toNum(p?.quantity),
  }))

  const org = input?.org ?? input?.organization
  const person = input?.person

  const normalized: Normalized = {
    deal_id: toStr(d?.id ?? d?.deal_id) || '',
    title: toStr(d?.title),
    pipeline_id,
    stage_id,
    org_id,
    org_name: toStr(org?.name),
    person_id,
    person_first_name: toStr(person?.first_name ?? person?.name) /* fallback */,
    person_last_name: toStr(person?.last_name),
    person_email: toStr(Array.isArray(person?.email) ? person.email[0]?.value ?? person.email[0] : person?.email),
    person_phone: toStr(Array.isArray(person?.phone) ? person.phone[0]?.value ?? person.phone[0] : person?.phone),
    sede_label,
    training_address,
    hours,
    alumnos,
    caes_label,
    fundae_label,
    hotel_label,
    prodextra,
    products,
  }

  // Seguridad: TODAS las IDs externas como string
  normalized.deal_id = String(normalized.deal_id)
  if (normalized.org_id !== null) normalized.org_id = String(normalized.org_id)
  if (normalized.person_id !== null) normalized.person_id = String(normalized.person_id)
  if (normalized.pipeline_id !== null) normalized.pipeline_id = String(normalized.pipeline_id)
  if (normalized.stage_id !== null) normalized.stage_id = String(normalized.stage_id)
  normalized.products = normalized.products.map(p => ({
    product_id: p.product_id !== null ? String(p.product_id) : null,
    name: p.name,
    code: p.code,
    quantity: p.quantity,
  }))

  return normalized
}

// ---- Persistencia ---------------------------------------------

async function upsertOrganization(normalized: Normalized) {
  if (!normalized.org_id && !normalized.org_name) return null
  const org_id = normalized.org_id ?? undefined
  return prisma2.organizations.upsert({
    where: { org_id: normalized.org_id ?? '' }, // String requerido
    update: {
      name: normalized.org_name ?? undefined,
    },
    create: {
      org_id: org_id!, // string
      name: normalized.org_name ?? null,
    },
  })
}

async function upsertPerson(normalized: Normalized) {
  if (!normalized.person_id && !normalized.person_first_name && !normalized.person_last_name) return null
  const person_id = normalized.person_id ?? undefined
  return prisma2.persons.upsert({
    where: { person_id: normalized.person_id ?? '' },
    update: {
      first_name: normalized.person_first_name ?? undefined,
      last_name: normalized.person_last_name ?? undefined,
      email: normalized.person_email ?? undefined,
      phone: normalized.person_phone ?? undefined,
    },
    create: {
      person_id: person_id!, // string
      first_name: normalized.person_first_name ?? null,
      last_name: normalized.person_last_name ?? null,
      email: normalized.person_email ?? null,
      phone: normalized.person_phone ?? null,
    },
  })
}

async function upsertDeal(normalized: Normalized) {
  return prisma2.deals.upsert({
    where: { deal_id: normalized.deal_id },
    update: {
      title: normalized.title ?? undefined,
      pipeline_id: normalized.pipeline_id ?? undefined,
      stage_id: normalized.stage_id ?? undefined,
      org_id: normalized.org_id ?? undefined,
      person_id: normalized.person_id ?? undefined,
      sede_label: normalized.sede_label ?? undefined,
      training_address: normalized.training_address ?? undefined,
      hours: normalized.hours ?? undefined,
      alumnos: normalized.alumnos ?? undefined,
      caes_label: normalized.caes_label ?? undefined,
      fundae_label: normalized.fundae_label ?? undefined,
      hotel_label: normalized.hotel_label ?? undefined,
      prodextra: normalized.prodextra ?? undefined,
    },
    create: {
      deal_id: normalized.deal_id,               // string
      title: normalized.title,
      pipeline_id: normalized.pipeline_id,
      stage_id: normalized.stage_id,
      org_id: normalized.org_id,                 // string | null
      person_id: normalized.person_id,           // string | null
      sede_label: normalized.sede_label,
      training_address: normalized.training_address,
      hours: normalized.hours,
      alumnos: normalized.alumnos,
      caes_label: normalized.caes_label,
      fundae_label: normalized.fundae_label,
      hotel_label: normalized.hotel_label,
      prodextra: normalized.prodextra,
    },
  })
}

async function replaceDealProducts(deal_id: string, products: Normalized['products']) {
  // estrategia simple: borrar e insertar
  await prisma2.deal_products.deleteMany({ where: { deal_id } })
  if (!products?.length) return
  await prisma2.deal_products.createMany({
    data: products.map(p => ({
      deal_id,
      product_id: p.product_id,
      name: p.name,
      code: p.code,
      quantity: p.quantity,
    })),
    skipDuplicates: true,
  })
}

// ---- Handler --------------------------------------------------

const handler: Handler = async (event) => {
  try {
    const path = event.path || ''
    const method = event.httpMethod

    // GET /.netlify/functions/deals?noSessions=true
    if (method === 'GET' && path.endsWith('/deals')) {
      const noSessions = event.queryStringParameters?.noSessions === 'true'
      if (noSessions) {
        const deals = await prisma2.deals.findMany({
          orderBy: { updated_at: 'desc' as const },
          include: {
            organization: true,
            person: true,
            deal_products: true,
          },
        })
        const mapped = deals.map(d => ({
          deal_id: d.deal_id,
          title: d.title,
          sede_label: d.sede_label,
          pipeline_id: d.pipeline_id,
          training_address: d.training_address,
          hours: d.hours,
          alumnos: d.alumnos,
          caes_label: d.caes_label,
          fundae_label: d.fundae_label,
          hotel_label: d.hotel_label,
          prodextra: d.prodextra,
          organization: d.organization ? { name: d.organization.name, org_id: d.organization.org_id } : null,
          person: d.person ? {
            person_id: d.person.person_id,
            first_name: d.person.first_name,
            last_name: d.person.last_name,
            email: d.person.email,
            phone: d.person.phone,
          } : null,
          products: d.deal_products?.map(p => ({
            id: p.id, deal_id: p.deal_id, product_id: p.product_id, name: p.name, code: p.code, quantity: p.quantity
          })),
        }))
        return ok({ ok: true, deals: mapped })
      }
      // otros listados se implementarán más adelante
      return ok({ ok: true, deals: [] })
    }

    // GET /.netlify/functions/deals/:dealId
    if (method === 'GET' && /\/deals\/[^/]+$/.test(path)) {
      const dealId = decodeURIComponent(path.split('/').pop()!)
      const deal = await prisma2.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: true,
          person: true,
          deal_products: true,
          deal_notes: true,
          documents: true,
        },
      })
      if (!deal) return fail('NOT_FOUND', 'Presupuesto no encontrado', 404)
      return ok({ ok: true, deal })
    }

    // POST /.netlify/functions/deals/import
    if (method === 'POST' && path.endsWith('/deals/import')) {
      const body = event.body ? JSON.parse(event.body) : {}
      const rawDealId = body?.dealId
      const dealId = toStr(rawDealId)
      if (!dealId) return fail('INVALID_DEAL_ID', 'dealId requerido', 400)

      // 1) Traer Pipedrive y normalizar
      const pd = await fetchDealFromPipedrive(dealId)
      const normalized = normalizeFromPD(pd)

      // 2) Upserts con IDs STRING
      await upsertOrganization(normalized)
      await upsertPerson(normalized)
      await upsertDeal(normalized)
      await replaceDealProducts(normalized.deal_id, normalized.products)

      return ok({ ok: true, deal_id: normalized.deal_id })
    }

    // PATCH /.netlify/functions/deals/:dealId
    if (method === 'PATCH' && /\/deals\/[^/]+$/.test(path)) {
      const dealId = decodeURIComponent(path.split('/').pop()!)
      const body = event.body ? JSON.parse(event.body) : {}
      const dealPatch = body?.deal ?? body

      // Filtrar solo campos permitidos
      const data: Record<string, any> = {}
      Object.keys(dealPatch || {}).forEach((k) => {
        if (EDITABLE_FIELDS.has(k)) data[k] = dealPatch[k]
      })

      if (Object.keys(data).length) {
        await prisma2.deals.update({
          where: { deal_id: String(dealId) },
          data,
        })
      }

      // (Opcional) comentarios
      // body.comments.create[] / update[] — implementar según modelo si fuera necesario

      return ok({ ok: true })
    }

    return fail('NOT_IMPLEMENTED', 'Ruta no implementada', 404)
  } catch (err: any) {
    return fail('INTERNAL_ERROR', err?.message || 'Error inesperado', 502)
  }
}

export { handler }
