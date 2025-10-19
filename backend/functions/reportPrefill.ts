// backend/functions/reportPrefill.ts
import { getPrisma } from './_shared/prisma'
import { successResponse, errorResponse, preflightResponse } from './_shared/response'
import { toMadridISOString } from './_shared/timezone'
import { toStringOrNull } from './_shared/sessions'

const METHOD_NOT_ALLOWED = errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405)

type RawSession = {
  id: string
  direccion: string | null
  nombre_cache?: string | null
  nombre?: string | null
  fecha_inicio_utc?: Date | null
  created_at?: Date | null
}

type RawDealProduct = {
  name?: string | null
  code?: string | null
}

type NormalizedSession = {
  id: string
  number: string
  nombre: string | null
  direccion: string | null
  fecha: string | null
  label: string
}

const toTimestamp = (value: Date | string | null | undefined): number | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? time : null
}

const compareSessions = (a: RawSession, b: RawSession): number => {
  const startA = toTimestamp(a.fecha_inicio_utc ?? null)
  const startB = toTimestamp(b.fecha_inicio_utc ?? null)
  if (startA !== null && startB !== null && startA !== startB) {
    return startA - startB
  }
  if (startA === null && startB !== null) return 1
  if (startA !== null && startB === null) return -1
  const createdA = toTimestamp(a.created_at ?? null) ?? 0
  const createdB = toTimestamp(b.created_at ?? null) ?? 0
  if (createdA !== createdB) return createdA - createdB
  return String(a.id ?? '').localeCompare(String(b.id ?? ''))
}

const normalizeString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : String(value)
  const trimmed = text.trim()
  return trimmed.length ? trimmed : null
}

const normalizeKey = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : String(value)
  const trimmed = text.trim()
  return trimmed.length ? trimmed.toLowerCase() : ''
}

const formatSessionLabel = (session: { id?: string; number?: string | null; nombre?: string | null; direccion?: string | null; label?: string | null }): string => {
  const explicit = normalizeString(session.label)
  if (explicit) return explicit

  const parts: string[] = []
  const number = normalizeString(session.number)
  if (number) parts.push(`Sesión ${number}`)

  const nombre = normalizeString(session.nombre)
  if (nombre) parts.push(nombre)

  if (!parts.length) {
    const id = normalizeString(session.id)
    if (id) parts.push(`Sesión ${id.slice(0, 8)}`)
  }

  const direccion = normalizeString(session.direccion)
  const base = parts.join(' – ')
  return `${base}${direccion ? ` (${direccion})` : ''}`.trim()
}

const mapSession = (session: RawSession, index: number): NormalizedSession | null => {
  const id = normalizeString(session.id)
  if (!id) return null

  const nombre = normalizeString(session.nombre ?? session.nombre_cache)
  const direccion = normalizeString(session.direccion)
  const fecha = session.fecha_inicio_utc ? toMadridISOString(session.fecha_inicio_utc) : null
  const number = String(index + 1)
  const label = formatSessionLabel({ id, number, nombre, direccion })

  return { id, number, nombre, direccion, fecha, label }
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse()
    }

    if (event.httpMethod !== 'POST') {
      return METHOD_NOT_ALLOWED
    }

    let payload: any = null
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    } catch {
      return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400)
    }

    const dealId = toStringOrNull(payload?.dealId ?? payload?.deal_id ?? payload?.id)
    if (!dealId) {
      return errorResponse('VALIDATION_ERROR', 'dealId es requerido', 400)
    }

    const prisma = getPrisma()

    const deal = await prisma.deals.findUnique({
      where: { deal_id: dealId },
      include: {
        organization: { select: { name: true } },
        person: { select: { first_name: true, last_name: true } },
        sessions: {
          select: {
            id: true,
            direccion: true,
            nombre_cache: true,
            fecha_inicio_utc: true,
            created_at: true,
          },
        },
        deal_products: {
          select: {
            name: true,
            code: true,
          },
        },
      },
    })

    if (!deal) {
      return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404)
    }

    const sessionsRaw: RawSession[] = Array.isArray(deal.sessions) ? deal.sessions : []
    const sortedSessions = sessionsRaw.slice().sort(compareSessions)
    const normalizedSessions: NormalizedSession[] = []

    sortedSessions.forEach((session, index) => {
      const mapped = mapSession(session, index)
      if (mapped) normalizedSessions.push(mapped)
    })

    const dealProductsRaw: RawDealProduct[] = Array.isArray(deal.deal_products)
      ? deal.deal_products
      : []

    const normalizedDealProducts = dealProductsRaw.map((product) => {
      const name = normalizeString(product?.name)
      const code = normalizeString(product?.code)
      return {
        name,
        code,
        nameKey: normalizeKey(product?.name),
        codeKey: normalizeKey(product?.code),
      }
    })

    const catalogWhere: any[] = []
    const nameValues = Array.from(
      new Set(
        normalizedDealProducts
          .map((product) => product.name)
          .filter((value): value is string => Boolean(value))
      )
    )
    if (nameValues.length) {
      catalogWhere.push({ name: { in: nameValues } })
    }

    const codeValues = Array.from(
      new Set(
        normalizedDealProducts
          .map((product) => product.code)
          .filter((value): value is string => Boolean(value))
      )
    )
    if (codeValues.length) {
      catalogWhere.push({ code: { in: codeValues } })
    }

    const templatesByKey = new Map<string, string | null>()

    if (catalogWhere.length) {
      const catalogProducts = await prisma.products.findMany({
        where: { OR: catalogWhere },
        select: { name: true, code: true, template: true },
      })

      catalogProducts.forEach((product) => {
        const template = normalizeString(product?.template)
        const nameKey = normalizeKey(product?.name)
        const codeKey = normalizeKey(product?.code)

        if (nameKey && (!templatesByKey.has(nameKey) || template)) {
          templatesByKey.set(nameKey, template ?? null)
        }

        if (codeKey && (!templatesByKey.has(codeKey) || template)) {
          templatesByKey.set(codeKey, template ?? null)
        }
      })
    }

    const mappedDealProducts = normalizedDealProducts.map((product) => {
      let template: string | null = null
      for (const key of [product.nameKey, product.codeKey]) {
        if (template) break
        if (!key) continue
        if (!templatesByKey.has(key)) continue
        const candidate = templatesByKey.get(key) ?? null
        const normalized = normalizeString(candidate)
        if (normalized) {
          template = normalized
          break
        }
      }

      return {
        name: product.name,
        code: product.code,
        template,
      }
    })

    const organizationName = normalizeString(deal.organization?.name)
    const contactFirst = normalizeString(deal.person?.first_name)
    const contactLast = normalizeString(deal.person?.last_name)
    const contacto = [contactFirst, contactLast].filter(Boolean).join(' ').trim()

    return successResponse({
      deal: {
        id: deal.deal_id,
        cliente: organizationName || '',
        contacto: contacto || '',
        comercial: '',
        sessions: normalizedSessions,
        products: mappedDealProducts,
      },
    })
  } catch (error) {
    console.error('[reportPrefill] handler error', error)
    return errorResponse('INTERNAL_ERROR', 'Error obteniendo el presupuesto', 500)
  }
}

export default handler
