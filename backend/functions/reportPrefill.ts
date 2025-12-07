// backend/functions/reportPrefill.ts
import { getPrisma } from './_shared/prisma'
import { successResponse, errorResponse, preflightResponse } from './_shared/response'
import { toMadridISOString } from './_shared/timezone'
import { compareSessionsForOrder, formatSessionLabel, toStringOrNull } from './_shared/sessions'

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

const normalizeKey = (value: unknown): string => {
  const normalized = toStringOrNull(value)
  return normalized ? normalized.toLowerCase() : ''
}

const mapSession = (session: RawSession, index: number): NormalizedSession | null => {
  const id = toStringOrNull(session.id)
  if (!id) return null

  const nombre = toStringOrNull(session.nombre ?? session.nombre_cache)
  const direccion = toStringOrNull(session.direccion)
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
        organizations: { select: { name: true } },
        persons: { select: { first_name: true, last_name: true, email: true } },
        sesiones: {
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

    const sessionsRaw: RawSession[] = Array.isArray(deal.sesiones) ? deal.sesiones : []
    const sortedSessions = sessionsRaw.slice().sort(compareSessionsForOrder)
    const normalizedSessions: NormalizedSession[] = []

    sortedSessions.forEach((session, index) => {
      const mapped = mapSession(session, index)
      if (mapped) normalizedSessions.push(mapped)
    })

    const dealProductsRaw: RawDealProduct[] = Array.isArray(deal.deal_products)
      ? deal.deal_products
      : []

    const normalizedDealProducts = dealProductsRaw.map((product) => {
      const name = toStringOrNull(product?.name)
      const code = toStringOrNull(product?.code)
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

      catalogProducts.forEach(
        (product: { name: string | null | undefined; code: string | null | undefined; template: string | null | undefined }) => {
        const template = toStringOrNull(product?.template)
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
        const normalized = toStringOrNull(candidate)
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

    if (
      typeof deal === 'object' &&
      deal !== null &&
      !('organization' in deal) &&
      'organizations' in (deal as Record<string, any>)
    ) {
      (deal as Record<string, any>).organizations = (deal as Record<string, any>).organizations
    }
    if (
      typeof deal === 'object' &&
      deal !== null &&
      !('person' in deal) &&
      'persons' in (deal as Record<string, any>)
    ) {
      (deal as Record<string, any>).persons = (deal as Record<string, any>).persons
    }

    const organizationName = toStringOrNull(deal.organizations?.name ?? (deal as any)?.organizations?.name)
    const contactFirst = toStringOrNull(deal.persons?.first_name ?? (deal as any)?.persons?.first_name)
    const contactLast = toStringOrNull(deal.persons?.last_name ?? (deal as any)?.persons?.last_name)
    const contactEmail = toStringOrNull(deal.persons?.email ?? (deal as any)?.persons?.email)
    const contacto = [contactFirst, contactLast].filter(Boolean).join(' ').trim()

    return successResponse({
      deal: {
        id: deal.deal_id,
        cliente: organizationName || '',
        contacto: contacto || '',
        contactoEmail: contactEmail || '',
        comercial: toStringOrNull(deal.comercial) || '',
        sesiones: normalizedSessions,
        products: mappedDealProducts,
      },
    })
  } catch (error) {
    console.error('[reportPrefill] handler error', error)
    return errorResponse('INTERNAL_ERROR', 'Error obteniendo el presupuesto', 500)
  }
}

export default handler
