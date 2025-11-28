import { useCallback, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Form, Spinner, Stack } from 'react-bootstrap'
import { ApiError } from '../../api/client'
import { importSesionesDesdeExcel, type ImportSesionesResult } from '../../api/sessions-import'

const COLUMN_MAP_PLACEHOLDER = `{
  "ID Negocio": "deal_id",
  "ID Producto": "deal_product_id",
  "Título": "nombre_cache",
  "Inicio": "fecha_inicio_utc",
  "Fin": "fecha_fin_utc",
  "Sala": "sala_id",
  "Dirección": "direccion",
  "Comentarios": "comentarios",
  "Estado": "estado",
  "Drive": "drive_url"
}`

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const [, base64] = result.split(',')
        resolve(base64 ?? result)
      } else {
        reject(new Error('No se pudo leer el fichero seleccionado.'))
      }
    }
    reader.onerror = (event) => {
      reject(event?.target?.error ?? new Error('No se pudo leer el fichero seleccionado.'))
    }
    reader.readAsDataURL(file)
  })
}

function parseColumnMap(raw: string): Record<string, string> | null {
  const trimmed = raw.trim()
  if (!trimmed.length) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, string>
  } catch (error) {
    console.error('columnMap no es JSON válido', error)
    throw new Error('El mapa de columnas debe ser JSON válido.')
  }
}

export function SessionsImportView() {
  const [file, setFile] = useState<File | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [columnMapText, setColumnMapText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<ImportSesionesResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedFileName = useMemo(() => file?.name ?? 'Ningún fichero seleccionado', [file])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null
    setFile(picked)
    setResult(null)
    setError(null)
  }, [])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!file) {
        setError('Selecciona un fichero Excel (.xlsx) para importar las sesiones.')
        return
      }

      setIsSubmitting(true)
      setResult(null)
      setError(null)

      try {
        const fileBase64 = await fileToBase64(file)
        const parsedColumnMap = columnMapText ? parseColumnMap(columnMapText) : null
        const response = await importSesionesDesdeExcel({
          fileBase64,
          fileName: file.name,
          sheetName: sheetName.trim() || null,
          columnMap: parsedColumnMap,
        })

        setResult(response)
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
        } else if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('No se pudo importar el fichero. Inténtalo de nuevo más tarde.')
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [file, columnMapText, sheetName],
  )

  return (
    <Stack gap={4}>
      <div>
        <h1 className="h3 mb-2">Importar sesiones</h1>
        <p className="text-muted mb-0">
          Sube un Excel con las sesiones y el sistema las insertará en la base de datos. Se utilizan los mismos
          alias de columnas que en el script CLI y puedes proporcionar un mapa personalizado si tus cabeceras no
          coinciden.
        </p>
      </div>

      <Card>
        <Card.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <Form.Group controlId="sessions-import-file">
              <Form.Label>Fichero Excel</Form.Label>
              <Form.Control type="file" accept=".xlsx,.xls" onChange={handleFileChange} disabled={isSubmitting} />
              <Form.Text className="text-muted">Selecciona un .xlsx con la primera fila como cabeceras.</Form.Text>
              <div className="mt-2 small text-muted">{selectedFileName}</div>
            </Form.Group>

            <Form.Group controlId="sessions-import-sheet">
              <Form.Label>Nombre de hoja (opcional)</Form.Label>
              <Form.Control
                type="text"
                placeholder="Si se deja vacío se usará la primera hoja"
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
                disabled={isSubmitting}
              />
            </Form.Group>

            <Form.Group controlId="sessions-import-column-map">
              <Form.Label>Mapa de columnas (opcional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={8}
                placeholder={COLUMN_MAP_PLACEHOLDER}
                value={columnMapText}
                onChange={(event) => setColumnMapText(event.target.value)}
                disabled={isSubmitting}
              />
              <Form.Text className="text-muted">
                Pega un JSON con las cabeceras de tu Excel como claves y el campo del ERP como valor
                (p.&nbsp;ej. "ID Producto" → "deal_product_id").
              </Form.Text>
            </Form.Group>

            <div className="d-flex flex-wrap gap-2 align-items-center">
              <Button type="submit" disabled={isSubmitting || !file}>
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Importando...
                  </>
                ) : (
                  'Importar sesiones'
                )}
              </Button>
              {isSubmitting && <Badge bg="info" text="dark">Subiendo y procesando...</Badge>}
            </div>
          </Form>
        </Card.Body>
      </Card>

      {error && (
        <Alert variant="danger" className="mb-0">
          {error}
        </Alert>
      )}

      {result && !error && (
        <Alert variant="success" className="mb-0">
          <div className="fw-semibold">Importación completada</div>
          <div className="mt-1">
            Se recibieron {result.received} filas y se insertaron {result.inserted} nuevas sesiones.
          </div>
          <div className="small text-muted">Los duplicados se omiten automáticamente.</div>
        </Alert>
      )}
    </Stack>
  )
}

export default SessionsImportView
