export type SessionDocumentsEventDetail = {
  dealId: string
  sessionId: string
}

export const SESSION_DOCUMENTS_EVENT = 'erp:session-documents'

const normalizeId = (value: unknown): string => {
  if (typeof value !== 'string') {
    if (value === null || value === undefined) return ''
    return String(value)
  }
  return value
    .split('\n')[0]
    .trim()
}

export function emitSessionDocumentsUpdated(detail: SessionDocumentsEventDetail): void {
  if (typeof window === 'undefined') return
  const dealId = normalizeId(detail.dealId)
  const sessionId = normalizeId(detail.sessionId)
  if (!dealId || !sessionId) return
  const event = new CustomEvent<SessionDocumentsEventDetail>(SESSION_DOCUMENTS_EVENT, {
    detail: { dealId, sessionId },
  })
  window.dispatchEvent(event)
}
