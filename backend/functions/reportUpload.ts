// backend/functions/reportUpload.ts
import { randomUUID } from 'crypto'
import { getPrisma } from './_shared/prisma'
import { successResponse, errorResponse, preflightResponse } from './_shared/response'
import { nowInMadridDate, toMadridISOString } from './_shared/timezone'
import { ensureSessionContext, resolveSessionNumber, toStringOrNull } from './_shared/sessions'
import { uploadSessionDocumentToGoogleDrive } from './_shared/googleDrive'

const METHOD_NOT_ALLOWED = errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405)

const normalizeDriveUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const sanitizeFileName = (name: unknown, fallback = 'Informe.pdf'): string => {
  if (typeof name !== 'string') return fallback
  const decoded = (() => {
    try {
      return decodeURIComponent(name)
    } catch {
      return name
    }
  })()
  const trimmed = decoded.trim()
  if (!trimmed.length) return fallback
  const sanitized = trimmed.replace(/[\\/:*?"<>|]+/g, '_')
  return sanitized.length ? sanitized : fallback
}

const base64ToBuffer = (value: unknown): Buffer | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized.length) return null
  try {
    return Buffer.from(normalized, 'base64')
  } catch {
    return null
  }
}

const mapSessionFile = (row: any) => ({
  id: row?.id ?? null,
  deal_id: row?.deal_id ?? null,
  sesion_id: row?.sesion_id ?? null,
  file_type: row?.file_type ?? null,
  compartir_formador: Boolean(row?.compartir_formador),
  added_at: row?.added_at ? toMadridISOString(row.added_at) : null,
  created_at: row?.created_at ? toMadridISOString(row.created_at) : null,
  updated_at: row?.updated_at ? toMadridISOString(row.updated_at) : null,
  drive_file_name: row?.drive_file_name ?? null,
  drive_web_view_link: row?.drive_web_view_link ?? null,
})

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
    const sessionId = toStringOrNull(payload?.sessionId ?? payload?.sesion_id ?? payload?.session_id)
    if (!dealId || !sessionId) {
      return errorResponse('VALIDATION_ERROR', 'dealId y sessionId son requeridos', 400)
    }

    const fileName = sanitizeFileName(payload?.fileName ?? payload?.nombre)
    const pdfBuffer = base64ToBuffer(payload?.pdfBase64 ?? payload?.base64 ?? payload?.data)
    if (!pdfBuffer) {
      return errorResponse('VALIDATION_ERROR', 'pdfBase64 es requerido', 400)
    }

    const prisma = getPrisma()
    const context = await ensureSessionContext(prisma, dealId, sessionId)
    if (context.error) {
      return context.error
    }

    const session = context.session!
    const sessionNumber = await resolveSessionNumber(prisma, session)
    const sessionName =
      (typeof session.nombre === 'string' && session.nombre.trim()) ||
      (typeof session.nombre_cache === 'string' && session.nombre_cache.trim()) ||
      null

    let sessionDriveUrl = normalizeDriveUrl(session.drive_url ?? null)

    const uploadResult = await uploadSessionDocumentToGoogleDrive({
      deal: session.deal,
      session,
      organizationName: session.deal?.organization?.name ?? null,
      sessionNumber,
      sessionName,
      fileName,
      mimeType: 'application/pdf',
      data: pdfBuffer,
    })

    const folderLink = normalizeDriveUrl(uploadResult.sessionFolderWebViewLink ?? null)
    if (folderLink && folderLink !== sessionDriveUrl) {
      try {
        await prisma.sessions.update({
          where: { id: sessionId },
          data: { drive_url: folderLink },
        })
        sessionDriveUrl = folderLink
      } catch (error) {
        console.warn('[reportUpload] No se pudo actualizar drive_url de la sesión', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const now = nowInMadridDate()
    let record: any = null
    let persistenceError: unknown = null
    try {
      record = await prisma.session_files.create({
        data: {
          id: randomUUID(),
          deal_id: dealId,
          sesion_id: sessionId,
          file_type: 'pdf',
          compartir_formador: true,
          added_at: now,
          created_at: now,
          updated_at: now,
          drive_file_name: uploadResult.driveFileName,
          drive_web_view_link: uploadResult.driveWebViewLink,
        },
      })
    } catch (error) {
      persistenceError = error
      console.error('[reportUpload] No se pudo registrar el documento en session_files', {
        sessionId,
        dealId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const responseBody: any = {
      document: record ? mapSessionFile(record) : null,
      drive_url: sessionDriveUrl,
    }

    if (persistenceError) {
      responseBody.warning = {
        code: 'PERSISTENCE_ERROR',
        message: 'El archivo se guardó en Drive pero no se pudo registrar en la sesión.',
      }
    }

    return successResponse(responseBody, persistenceError ? 207 : 200)
  } catch (error) {
    console.error('[reportUpload] handler error', error)
    return errorResponse('INTERNAL_ERROR', 'Error guardando el informe', 500)
  }
}

export default handler
