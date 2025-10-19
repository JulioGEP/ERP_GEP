export type ToastVariant = 'success' | 'danger' | 'info' | 'warning'

export type ToastEventDetail = {
  variant: ToastVariant
  message: string
}

export const TOAST_EVENT = 'erp:toast'

export function emitToast(detail: ToastEventDetail): void {
  if (typeof window === 'undefined') return
  const message = typeof detail.message === 'string' ? detail.message.trim() : ''
  if (!message) return
  const variant: ToastVariant = detail.variant ?? 'info'
  const event = new CustomEvent<ToastEventDetail>(TOAST_EVENT, {
    detail: { variant, message },
  })
  window.dispatchEvent(event)
}
