import * as XLSX from 'xlsx'
import { createHttpHandler } from './_shared/http'
import { errorResponse, successResponse } from './_shared/response'
import { requireAuth } from './_shared/auth'
import { getPrisma } from './_shared/prisma'

const METHOD_NOT_ALLOWED = errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405)

const COLUMN_ALIASES: Record<string, string[]> = {
  deal_id: ['deal_id', 'deal', 'negocio', 'id_negocio'],
  deal_product_id: ['deal_product_id', 'producto', 'id_producto'],
  nombre_cache: ['nombre_cache', 'titulo', 'título', 'nombre'],
  fecha_inicio_utc: ['fecha_inicio_utc', 'inicio', 'start', 'fecha_inicio'],
  fecha_fin_utc: ['fecha_fin_utc', 'fin', 'end', 'fecha_fin'],
  sala_id: ['sala_id', 'sala'],
  direccion: ['direccion', 'dirección'],
  comentarios: ['comentarios', 'notas', 'observaciones'],
  estado: ['estado', 'status'],
  drive_url: ['drive_url', 'drive', 'url_drive'],
  id: ['id', 'sesion_id', 'session_id'],
}

const REQUIRED_FIELDS = ['deal_id', 'deal_product_id', 'nombre_cache'] as const
const OPTIONAL_FIELDS = ['fecha_inicio_utc', 'fecha_fin_utc', 'sala_id', 'direccion', 'comentarios', 'estado', 'drive_url', 'id'] as const
const ALLOWED_TARGETS = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS])

const parseJsonColumnMap = (raw: unknown): Record<string, string> | null => {
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw).flatMap(([key, value]) => {
    if (typeof key !== 'string' || typeof value !== 'string') return [] as Array<[string, string]>
    const normalizedSource = key.trim().toLowerCase()
    const normalizedTarget = value.trim()
    if (!normalizedSource) return [] as Array<[string, string]>
    if (!normalizedTarget || !ALLOWED_TARGETS.has(normalizedTarget)) return [] as Array<[string, string]>
    return [[normalizedSource, normalizedTarget]]
  })

  if (!entries.length) return null
  return Object.fromEntries(entries)
}

const findMissingMappedColumns = (
  rows: Array<Record<string, any>>,
  columnMap: Record<string, string>,
): string[] => {
  const missing: string[] = []
  for (const sourceKey of Object.keys(columnMap)) {
    const isPresent = rows.some((row) => {
      const normalizedKeys = Object.keys(row).map((key) => key.trim().toLowerCase())
      return normalizedKeys.includes(sourceKey)
    })
    if (!isPresent) missing.push(sourceKey)
  }
  return missing
}

const excelDateToJsDate = (excelValue: any): Date | null => {
  const parsed = XLSX.SSF.parse_date_code(excelValue)
  if (!parsed) return null
  const { y, m, d, H, M, S } = parsed
  return new Date(Date.UTC(y, m - 1, d, H ?? 0, M ?? 0, S ?? 0))
}

const normalizeDate = (value: any): Date | null => {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number') return excelDateToJsDate(value)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const resolveValue = (
  row: Record<string, any>,
  targetKey: string,
  columnMap: Record<string, string> | null,
): any => {
  if (columnMap) {
    const sourceKey = Object.keys(columnMap).find((source) => columnMap[source] === targetKey)
    if (sourceKey) {
      const matchKey = Object.keys(row).find((key) => key.trim().toLowerCase() === sourceKey)
      if (matchKey && row[matchKey] !== undefined) return row[matchKey]
    }
  }

  const aliases = COLUMN_ALIASES[targetKey] ?? []
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.trim().toLowerCase()
    if (aliases.includes(normalizedKey)) return value
    if (normalizedKey === targetKey) return value
  }
  return row[targetKey]
}

const normalizeRow = (
  row: Record<string, any>,
  index: number,
  columnMap: Record<string, string> | null,
): any => {
  const normalized: Record<string, any> = {}
  for (const field of REQUIRED_FIELDS) {
    normalized[field] = resolveValue(row, field, columnMap)
    if (!normalized[field]) {
      throw new Error(`La fila ${index + 1} no tiene el campo obligatorio ${field}.`)
    }
  }

  return {
    id: resolveValue(row, 'id', columnMap) ?? undefined,
    deal_id: normalized.deal_id,
    deal_product_id: normalized.deal_product_id,
    nombre_cache: normalized.nombre_cache,
    fecha_inicio_utc: normalizeDate(resolveValue(row, 'fecha_inicio_utc', columnMap)),
    fecha_fin_utc: normalizeDate(resolveValue(row, 'fecha_fin_utc', columnMap)),
    sala_id: resolveValue(row, 'sala_id', columnMap) ?? null,
    direccion: resolveValue(row, 'direccion', columnMap) ?? '',
    comentarios: resolveValue(row, 'comentarios', columnMap) ?? null,
    estado: resolveValue(row, 'estado', columnMap) ?? undefined,
    drive_url: resolveValue(row, 'drive_url', columnMap) ?? null,
  }
}

const extractRowsFromBase64Excel = (base64: string, sheetName?: string | null): any[] => {
  const cleaned = base64.includes(',') ? base64.slice(base64.lastIndexOf(',') + 1) : base64
  const buffer = Buffer.from(cleaned, 'base64')
  if (!buffer.length) throw new Error('El fichero está vacío o no se pudo leer.')

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const chosenSheet = sheetName ?? workbook.SheetNames[0]
  if (!chosenSheet || !workbook.Sheets[chosenSheet]) {
    throw new Error(`No se encontró la hoja "${sheetName ?? ''}" en el Excel.`)
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[chosenSheet], {
    defval: null,
    raw: true,
    blankrows: false,
  })
}

type ImportSesionesRequest = {
  fileBase64?: string | null
  fileName?: string | null
  sheetName?: string | null
  columnMap?: Record<string, string> | null
}

type ImportSesionesResponse = {
  inserted: number
  received: number
}

export const handler = createHttpHandler<ImportSesionesRequest>(async (request) => {
  if (request.method !== 'POST') {
    return METHOD_NOT_ALLOWED
  }

  const prisma = getPrisma()
  await requireAuth(request, prisma, { requireRoles: ['Admin'] })

  const payload = request.body || {}
  const base64 = typeof payload.fileBase64 === 'string' ? payload.fileBase64.trim() : ''
  if (!base64) {
    return errorResponse('VALIDATION_ERROR', 'Debes adjuntar un Excel en base64.', 400)
  }

  const columnMap = parseJsonColumnMap(payload.columnMap)
  const sheetName = typeof payload.sheetName === 'string' ? payload.sheetName.trim() || null : null

  let sourceRows: any[] = []
  try {
    sourceRows = extractRowsFromBase64Excel(base64, sheetName)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo leer el Excel proporcionado.'
    return errorResponse('INVALID_FILE', message, 400)
  }

  if (!sourceRows.length) {
    return errorResponse('VALIDATION_ERROR', 'El archivo no contiene filas de datos.', 400)
  }

  if (columnMap) {
    const missingColumns = findMissingMappedColumns(sourceRows, columnMap)
    if (missingColumns.length) {
      return errorResponse(
        'VALIDATION_ERROR',
        `El Excel no contiene las columnas mapeadas: ${missingColumns.join(', ')}.`,
        400,
      )
    }
  }

  let payloadRows: any[] = []
  try {
    payloadRows = sourceRows.map((row, index) => normalizeRow(row, index, columnMap))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo normalizar el fichero.'
    return errorResponse('VALIDATION_ERROR', message, 400)
  }

  const result = await prisma.sesiones.createMany({
    data: payloadRows,
    skipDuplicates: true,
  })

  const response: ImportSesionesResponse = {
    inserted: result.count,
    received: payloadRows.length,
  }

  return successResponse(response)
})

export default handler
