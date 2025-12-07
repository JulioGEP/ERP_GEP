import { sendEmail } from './_shared/mailer'
import { preflightResponse, errorResponse, successResponse } from './_shared/response'

const ALLOWED_ORIGIN = process.env.REPORTS_ALLOWED_ORIGIN || 'https://www.gepservices.es'

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Expose-Headers': 'content-type',
}

type HandlerEvent = {
  httpMethod?: string
  body?: string | null
}

type HandlerResponse = {
  statusCode: number
  headers?: Record<string, string>
  body?: string
}

type RequestBody = {
  to?: string
  cc?: string | string[]
  subject?: string
  body?: string
  sender?: string | null
}

const parseEmails = (value: string | string[] | undefined | null): string | undefined => {
  if (!value) return undefined
  const items = Array.isArray(value) ? value : String(value).split(',')
  const normalized = Array.from(
    new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item && item.includes('@')))),
  )
  return normalized.length ? normalized.join(', ') : undefined
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      const res = preflightResponse()
      return { ...res, headers: { ...(res.headers || {}), ...cors } }
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }) }
    }

    let payload: RequestBody = {}
    try {
      payload = event.body ? JSON.parse(event.body) : {}
    } catch {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'INVALID_JSON' }) }
    }

    const to = parseEmails(payload.to)
    const cc = parseEmails(payload.cc)
    const subject = typeof payload.subject === 'string' ? payload.subject.trim() : ''
    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    const sender = typeof payload.sender === 'string' ? payload.sender.trim() : ''

    if (!to || !subject || !body) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'VALIDATION_ERROR' }) }
    }

    await sendEmail({ to, cc, subject, text: body, from: sender || null, replyTo: sender || null })

    const res = successResponse({ ok: true })
    return { ...res, headers: { ...(res.headers || {}), ...cors } }
  } catch (error) {
    console.error('[sendReportEmail] error', error)
    const res = errorResponse('INTERNAL_ERROR', 'No se pudo enviar el email', 500)
    return { ...res, headers: { ...(res.headers || {}), ...cors } }
  }
}

export default handler
