// backend/functions/reportUpload.ts
import { randomUUID } from 'crypto'
import { createHttpHandler } from './_shared/http'
import { getPrisma } from './_shared/prisma'
import { successResponse, errorResponse } from './_shared/response'
import { nowInMadridDate, toMadridISOString } from './_shared/timezone'
import { ensureSessionContext, resolveSessionNumber, toStringOrNull } from './_shared/sessions'
import { normalizeDriveUrl } from './_shared/drive'
import { uploadSessionDocumentToGoogleDrive } from './_shared/googleDrive'

const METHOD_NOT_ALLOWED = errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405)

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

export const handler = createHttpHandler<any>(async (request) => {
  try {
    if (request.method !== 'POST') {
      return METHOD_NOT_ALLOWED
    }

    const payload =
      request.body && typeof request.body === 'object' ? (request.body as any) : {}

    const dealId = toStringOrNull(payload?.dealId ?? payload?.deal_id ?? payload?.id)
    const sessionId = toStringOrNull(payload?.sessionId ?? payload?.sesion_id ?? payload?.sesion_id)
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
      deal: session.deals,
      session,
      organizationName:
        session.deals?.organizations?.name ?? (session.deals as any)?.organizations?.name ?? null,
      sessionNumber,
      sessionName,
      fileName,
      mimeType: 'application/pdf',
      data: pdfBuffer,
      targetSubfolderName: 'Documentos del deal',
    })

    const folderLink = normalizeDriveUrl(uploadResult.sessionFolderWebViewLink ?? null)
    if (folderLink && folderLink !== sessionDriveUrl) {
      try {
        await prisma.sesiones.update({
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
    const createPayload = {
      id: randomUUID(),
      deal_id: dealId,
      sesion_id: sessionId,
      file_type: 'pdf',
      compartir_formador: true,
      added_at: now,
      updated_at: now,
      drive_file_name: uploadResult.driveFileName,
      drive_web_view_link: uploadResult.driveWebViewLink,
    }

    try {
      record = await prisma.sesion_files.create({
        data: createPayload,
      })
    } catch (error: any) {
      const errorCode = error?.code ?? (typeof error === 'object' ? (error as any)?.code : null)
      if (errorCode === 'P2002') {
        try {
          const updateResult = await prisma.sesion_files.updateMany({
  where: {
    sesion_id: sessionId,
    drive_file_name: uploadResult.driveFileName,
  },
  data: {
    deal_id: dealId,
    file_type: 'pdf',
    compartir_formador: true,
    added_at: now,
    updated_at: now,
    drive_file_name: uploadResult.driveFileName,
    drive_web_view_link: uploadResult.driveWebViewLink,
  },
})

if (updateResult.count > 0) {
  // recuperamos el registro para devolverlo en la respuesta
  record = await prisma.sesion_files.findFirst({
    where: { sesion_id: sessionId, drive_file_name: uploadResult.driveFileName },
  })
}

console.warn('[reportUpload] Documento existente actualizado en sesion_files', {
  sessionId,
  dealId,
  driveFileName: uploadResult.driveFileName,
  })

        } catch (updateError) {
          persistenceError = updateError
          console.error('[reportUpload] No se pudo actualizar el documento existente en session_files', {
            sessionId,
            dealId,
            error:
              updateError instanceof Error ? updateError.message : String(updateError),
          })
        }
      } else {
        persistenceError = error
        console.error('[reportUpload] No se pudo registrar el documento en session_files', {
          sessionId,
          dealId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
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
})

export default handler
