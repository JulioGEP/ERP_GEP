import { postJson } from './client'

export type ImportSesionesPayload = {
  fileBase64: string
  fileName?: string | null
  sheetName?: string | null
  columnMap?: Record<string, string> | null
}

export type ImportSesionesResult = {
  inserted: number
  received: number
}

export async function importSesionesDesdeExcel(payload: ImportSesionesPayload) {
  return postJson<ImportSesionesResult>('/api/import-sesiones-bulk', payload, {
    defaultErrorMessage: 'No se pudo importar las sesiones. Comprueba el fichero e inténtalo de nuevo.',
  })
}
