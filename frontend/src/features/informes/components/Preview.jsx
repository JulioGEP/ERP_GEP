import React, { useEffect, useMemo, useRef, useState } from 'react'
import { generateReportPdfmake } from '../pdf/reportPdfmake'
import { triesKey, htmlKey } from '../utils/keys'
import { emitToast } from '../../../utils/toast'
import { emitSessionDocumentsUpdated } from '../../../utils/sessionDocumentsEvents'

const normalizeDisplay = (value) => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : String(value)
  return text.trim()
}

const formatSessionLabel = (session) => {
  if (!session) return ''
  const explicit = normalizeDisplay(session.label)
  if (explicit) return explicit

  const parts = []
  const number = normalizeDisplay(session.number)
  if (number) parts.push(`Sesión ${number}`)

  const nombre = normalizeDisplay(session.nombre)
  if (nombre) parts.push(nombre)

  if (!parts.length) {
    const id = normalizeDisplay(session.id)
    if (id) parts.push(`Sesión ${id.slice(0, 8)}`)
  }

  const direccion = normalizeDisplay(session.direccion)
  const base = parts.join(' – ')
  return `${base}${direccion ? ` (${direccion})` : ''}`.trim()
}

const maxTries = 3

const toBase64FromArrayBuffer = (buffer) => {
  if (!buffer) return null
  try {
    const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < source.byteLength; i += 1) {
      binary += String.fromCharCode(source[i])
    }
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      return window.btoa(binary)
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(binary, 'binary').toString('base64')
    }
  } catch (error) {
    console.warn('No se pudo convertir el PDF a Base64 desde ArrayBuffer.', error)
  }
  return null
}

const sanitizeBase64 = (value) => (typeof value === 'string' ? value.replace(/\s+/g, '').trim() : '')

const extractPdfBase64 = (pdf) => {
  if (!pdf || typeof pdf !== 'object') return null

  const direct = sanitizeBase64(pdf.base64)
  if (direct) return direct

  if (typeof pdf.dataUrl === 'string') {
    const [, encoded = ''] = pdf.dataUrl.split(',')
    const normalized = sanitizeBase64(encoded)
    if (normalized) return normalized
  }

  if (pdf.arrayBuffer) {
    return toBase64FromArrayBuffer(pdf.arrayBuffer)
  }

  return null
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const stripImagesFromDatos = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripImagesFromDatos)
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto === Object.prototype || proto === null) {
      return Object.keys(value).reduce((acc, key) => {
        if (key === 'imagenes') return acc
        acc[key] = stripImagesFromDatos(value[key])
        return acc
      }, {})
    }
  }
  return value
}

const preventivoHeadings = {
  ES: {
    generales: 'Datos generales',
    registro: 'Registro',
    trabajos: 'Trabajos',
    tareas: 'Tareas',
    observaciones: 'Observaciones',
    incidencias: 'Incidencias',
    firma: 'Firma',
    anexos: 'Anexo de imágenes',
  },
  CA: {
    generales: 'Dades generals',
    registro: 'Registre',
    trabajos: 'Treballs',
    tareas: 'Tasques',
    observaciones: 'Observacions',
    incidencias: 'Incidències',
    firma: 'Signatura',
    anexos: "Annex d'imatges",
  },
  EN: {
    generales: 'General information',
    registro: 'Logbook',
    trabajos: 'Works performed',
    tareas: 'Tasks',
    observaciones: 'Observations',
    incidencias: 'Incidents',
    firma: 'Signature',
    anexos: 'Image annex',
  },
}

const preventivoCardLabels = {
  ES: { registro: 'Registro', bombero: 'Bombero/a', fecha: 'Fecha ejercicio' },
  CA: { registro: 'Registre', bombero: 'Bomber/a', fecha: "Data de l'exercici" },
  EN: { registro: 'Logbook', bombero: 'Firefighter', fecha: 'Exercise date' },
}

const preventivoSectionKeys = ['trabajos', 'tareas', 'observaciones', 'incidencias']

const normalizeText = (value = '') =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const preventivoTextToHtml = (text = '', idioma = 'ES', options = {}) => {
  const { hasImages = true } = options
  const lang = (idioma || 'ES').toUpperCase()
  const labels = preventivoHeadings[lang] || preventivoHeadings.ES
  const order = [
    labels.generales,
    labels.registro,
    labels.trabajos,
    labels.tareas,
    labels.observaciones,
    labels.incidencias,
    labels.firma,
    labels.anexos,
  ]
  const generalKey = normalizeText(labels.generales)
  const lookup = new Map(order.map((title) => [normalizeText(title), title]))
  const skipTitles = new Set([generalKey])
  if (!hasImages && labels.anexos) {
    skipTitles.add(normalizeText(labels.anexos))
  }

  const lines = String(text || '').split(/\r?\n/)
  const parts = []
  let buffer = []
  let currentSection = null

  const flushBuffer = () => {
    const raw = buffer.join('\n').trim()
    buffer = []
    if (!raw) return
    if (currentSection?.skip) return
    const paragraphs = raw.split(/\n{2,}/)
    paragraphs.forEach((paragraph) => {
      const trimmed = paragraph.trim()
      if (!trimmed) return
      const html = escapeHtml(trimmed).replace(/\n/g, '<br />')
      parts.push(`<p>${html}</p>`)
    })
  }

  const closeSection = () => {
    flushBuffer()
    if (currentSection && !currentSection.skip) {
      parts.push('</section>')
    }
    currentSection = null
  }

  const openSection = (title) => {
    closeSection()
    const normalized = normalizeText(title)
    const skip = skipTitles.has(normalized)
    currentSection = { title, skip }
    if (!skip) {
      parts.push(`<section><h3>${title}</h3>`)
    }
  }

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    const heading = lookup.get(normalizeText(trimmed.replace(/[:：]\s*$/, '')))
    if (heading) {
      openSection(heading)
    } else {
      buffer.push(rawLine)
    }
  })

  closeSection()

  if (!parts.length) {
    const sanitizedLines = []
    let skipping = false

    lines.forEach((rawLine) => {
      const trimmed = rawLine.trim()
      const normalized = normalizeText(trimmed.replace(/[:：]\s*$/, ''))
      if (!skipping && normalized && skipTitles.has(normalized)) {
        skipping = true
        return
      }
      if (skipping) {
        if (!trimmed) {
          skipping = false
        } else if (lookup.has(normalized) && !skipTitles.has(normalized)) {
          skipping = false
        }
      }
      if (!skipping) sanitizedLines.push(rawLine)
    })

    const fallbackText = sanitizedLines.join('\n').trim()
    const fallback = escapeHtml(fallbackText)
    return fallback ? `<p>${fallback.replace(/\n/g, '<br />')}</p>` : ''
  }

  return parts.join('')
}

/**
 * Editor NO controlado para el HTML de IA (sin saltos de cursor):
 * - Inicializa innerHTML con initialHtml (o lo guardado).
 * - Guarda en sessionStorage y notifica onChange(html) en cada cambio.
 */
function EditableHtml({ dealId, initialHtml, onChange }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const nextHtml = initialHtml || ''
    if (ref.current.innerHTML !== nextHtml) {
      ref.current.innerHTML = nextHtml
    }
  }, [initialHtml, dealId])

  const handleInput = () => {
    const html = ref.current?.innerHTML || ''
    try { sessionStorage.setItem(htmlKey(dealId), html) } catch {}
    onChange?.(html)
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="form-control"
      style={{ minHeight: 220, lineHeight: 1.5, overflow: 'auto' }}
      onInput={handleInput}
    />
  )
}

// Acepta draft o data (compat con tu App)
export default function Preview(props) {
  const { onBack, title = 'Informe de Formación', type: propType } = props
  const draft = props.draft ?? props.data ?? {}
  const { datos, imagenes, formador, dealId, type: draftType, session } = draft
  const type = propType || draftType || 'formacion'
  const isSimulacro = type === 'simulacro'
  const isPreventivo = type === 'preventivo' || type === 'preventivo-ebro'
  const isPreventivoEbro = type === 'preventivo-ebro'
  const idioma = (datos?.idioma || formador?.idioma || 'ES').toUpperCase()
  const idiomaLabel = idioma === 'CA' ? 'Català' : idioma === 'EN' ? 'English' : 'Castellano'
  const preventivoLabels = preventivoHeadings[idioma] || preventivoHeadings.ES
  const preventivoCard = preventivoCardLabels[idioma] || preventivoCardLabels.ES
  const preventivoSectionData = preventivoSectionKeys.map((key) => ({
    key,
    label: preventivoLabels[key],
    texto: datos?.preventivo?.[key] || '',
    imagenes: Array.isArray(datos?.preventivo?.imagenes?.[key]) ? datos.preventivo.imagenes[key] : [],
  }))
  const hasPreventivoSectionImages = preventivoSectionData.some(({ imagenes }) => imagenes.length > 0)
  const showLegacyPreventivoImages = isPreventivoEbro && !hasPreventivoSectionImages
  const globalImagesAvailable = Array.isArray(imagenes) && imagenes.length > 0 && (!isPreventivoEbro || showLegacyPreventivoImages)
  const direccionSedeLabel = isPreventivo
    ? 'Dirección del Preventivo'
    : isSimulacro
      ? 'Dirección del simulacro'
      : 'Dirección de la formación'
  const sessionLabel = useMemo(() => formatSessionLabel(session), [session])
  const bomberosRaw = (formador?.nombre || '').trim()
  const bomberosList = bomberosRaw
    ? bomberosRaw.split(/\s*(?:[,;]|\r?\n)+\s*/).map((name) => name.trim()).filter(Boolean)
    : []
  const bomberosDisplay = bomberosList.length ? bomberosList : bomberosRaw ? [bomberosRaw] : ['—']
  const draftHeading = useMemo(() => {
    const raw = (title || '').trim()
    if (!raw) return 'Borrador del informe'
    const match = raw.match(/^Informe\s+(de\s+)?(.+)$/i)
    if (match) {
      const [, hasDe, rest] = match
      const detail = (rest || '').trim()
      if (!detail) return 'Borrador del informe'
      return hasDe ? `Borrador del informe de ${detail}` : `Borrador del informe ${detail}`
    }
    return /^Informe\b/i.test(raw) ? `Borrador del ${raw}` : `Borrador del informe ${raw}`
  }, [title])

  const [aiHtml, setAiHtml] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [lastUpload, setLastUpload] = useState(null)

  // Cargar contador + HTML guardado
  useEffect(() => {
    if (dealId) {
      try {
        const savedTries = Number(localStorage.getItem(triesKey(dealId)) || '0')
        setTries(isNaN(savedTries) ? 0 : savedTries)
      } catch {}
      try {
        const savedHtml = sessionStorage.getItem(htmlKey(dealId))
        if (savedHtml) setAiHtml(savedHtml)
      } catch {}
    } else {
      setTries(0); setAiHtml(null)
    }
  }, [dealId])

  useEffect(() => {
    setLastUpload(null)
  }, [dealId, session?.id])

  const resetLocalForDeal = () => {
    try {
      localStorage.removeItem(triesKey(dealId))
      sessionStorage.removeItem(htmlKey(dealId))
    } catch {}
    setTries(0); setAiHtml(null)
  }

  const tieneContenido = useMemo(() => {
    if (!datos) return false
    if (isSimulacro) {
      return (
        (datos.cronologia?.length || 0) > 0 ||
        (datos.desarrollo || '').trim() !== '' ||
        Object.values(datos?.comentarios || {}).some(v => (v || '').trim() !== '') ||
        (Array.isArray(imagenes) && imagenes.length > 0)
      )
    }
    if (isPreventivo) {
      const secciones = datos?.preventivo || {}
      const hasText = preventivoSectionKeys.some((key) => {
        const value = secciones?.[key]
        return typeof value === 'string' && value.trim() !== ''
      })
      const imagenesPorSeccion = secciones?.imagenes || {}
      const hasSectionImages = preventivoSectionKeys.some(
        (key) => Array.isArray(imagenesPorSeccion?.[key]) && imagenesPorSeccion[key].length > 0
      )
      return (
        hasText ||
        hasSectionImages ||
        (Array.isArray(imagenes) && imagenes.length > 0)
      )
    }
    return (
      (datos.formacionTitulo && (datos.contenidoTeorica?.length || datos.contenidoPractica?.length)) ||
      Object.values(datos?.comentarios || {}).some(v => (v || '').trim() !== '') ||
      (Array.isArray(imagenes) && imagenes.length > 0)
    )
  }, [datos, imagenes, isPreventivo, isSimulacro])

  const mejorarInforme = async () => {
    if (dealId && !isPreventivoEbro && tries >= maxTries) return
    setAiBusy(true)
    try {
      const r = await fetch('/.netlify/functions/generateReport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formador,
          datos: stripImagesFromDatos(datos),
          previousHtml: aiHtml,
        }),
      })
      const raw = await r.text()
      let data = null
      if (raw) {
        try {
          data = JSON.parse(raw)
        } catch (parseError) {
          console.error('Respuesta IA no JSON:', parseError, raw)
        }
      }

      if (!r.ok) {
        const msg = data?.error || data?.message || raw || 'Error IA'
        throw new Error(msg)
      }

      let html = (data?.html || '').trim()
      if (!html) throw new Error('La IA devolvió un informe vacío.')

      if (isPreventivo) {
        const hasImages = Array.isArray(imagenes) && imagenes.length > 0
        html = preventivoTextToHtml(html, idioma, { hasImages })
      }

      setAiHtml(html)
      if (dealId) {
        try { sessionStorage.setItem(htmlKey(dealId), html) } catch {}
      }

      try {
        await generateReportPdfmake({ dealId, datos, formador, imagenes, type, aiHtml: html })
      } catch (pdfError) {
        console.error('[Preview] Error al generar el PDF tras mejorar informe', pdfError)
        emitToast({ variant: 'danger', message: 'No se pudo generar el PDF.' })
      }

      if (dealId) {
        const next = isPreventivoEbro ? tries + 1 : Math.min(tries + 1, maxTries)
        setTries(next)
        try { localStorage.setItem(triesKey(dealId), String(next)) } catch {}
      }
    } catch (e) {
      console.error(e)
      const message = e?.message ? `No se ha podido mejorar el informe. ${e.message}` : 'No se ha podido mejorar el informe.'
      emitToast({ variant: 'danger', message })
    } finally {
      setAiBusy(false)
    }
  }

  const guardarEnDrive = async () => {
    if (!dealId) {
      emitToast({ variant: 'warning', message: 'El Nº de presupuesto es obligatorio.' })
      return
    }
    if (!session || !session.id) {
      emitToast({ variant: 'warning', message: 'Selecciona la sesión correspondiente en el formulario antes de guardar el informe.' })
      return
    }
    if (!tieneContenido) {
      emitToast({ variant: 'warning', message: 'Completa el contenido del informe antes de guardarlo.' })
      return
    }

    setUploading(true)
    try {
      let pdf
      try {
        pdf = await generateReportPdfmake({ dealId, datos, formador, imagenes, type, aiHtml })
      } catch (error) {
        console.error('[Preview] Error al generar el PDF antes de subirlo a Drive', error)
        emitToast({ variant: 'danger', message: 'No se pudo generar el PDF.' })
        return
      }

      const base64 = extractPdfBase64(pdf)
      if (!base64) {
        const preparationError = new Error('No se pudo preparar el PDF para subirlo a Drive.')
        preparationError.name = 'PDF_BASE64_ERROR'
        throw preparationError
      }

      const payload = {
        dealId,
        sessionId: session.id,
        fileName: pdf?.fileName || `Informe-${dealId}.pdf`,
        pdfBase64: base64,
        sessionNumber: session.number ?? null,
        sessionName: session.nombre ?? null,
      }

      const uploadWithRetry = async (body) => {
        let lastError = null
        const attemptUpload = async () => {
          try {
            const response = await fetch('/.netlify/functions/reportUpload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })

            const raw = await response.text()
            let data = null
            if (raw) {
              try {
                data = JSON.parse(raw)
              } catch (parseError) {
                console.error('Respuesta reportUpload no JSON:', parseError, raw)
              }
            }

            if (!response.ok) {
              const message = data?.error || data?.message || raw || 'Error guardando el PDF en Drive.'
              const uploadError = new Error(message)
              uploadError.name = 'UPLOAD_ERROR'
              uploadError.status = response.status
              uploadError.response = data
              uploadError.raw = raw
              throw uploadError
            }

            return data || {}
          } catch (error) {
            const normalized = error instanceof Error ? error : new Error('Error guardando el PDF en Drive.')
            if (!(normalized instanceof Error)) {
              throw error
            }
            if (!normalized.name) normalized.name = 'UPLOAD_ERROR'
            throw normalized
          }
        }

        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            return await attemptUpload()
          } catch (error) {
            lastError = error
            const status = typeof error?.status === 'number' ? error.status : null
            const shouldRetry = status === null || status >= 500
            if (!shouldRetry || attempt === 2) {
              throw error
            }
            await delay(500 * attempt)
          }
        }

        throw lastError || new Error('Error guardando el PDF en Drive.')
      }

      const data = await uploadWithRetry(payload)

      if (data?.document) {
        setLastUpload({ ...data.document, drive_url: data?.drive_url || null })
        emitSessionDocumentsUpdated({ dealId, sessionId: session.id })
      } else {
        setLastUpload(null)
      }

      const warningMessage = typeof data?.warning?.message === 'string' ? data.warning.message.trim() : ''
      if (warningMessage) {
        emitToast({ variant: 'warning', message: warningMessage })
      } else {
        emitToast({ variant: 'success', message: 'Documento guardado en Drive.' })
      }
    } catch (error) {
      console.error('[Preview] Error guardando el informe en Drive', error)
      const message = error instanceof Error && typeof error.message === 'string'
        ? error.message.trim()
        : 'No se ha podido guardar el PDF.'
      emitToast({ variant: 'danger', message: message || 'No se ha podido guardar el PDF.' })
    } finally {
      setUploading(false)
    }
  }

  const triesLabel = isPreventivoEbro ? null : `${dealId ? tries : 0}/${maxTries}`
  const quedanIntentos = !dealId || isPreventivoEbro || tries < maxTries

  return (
    <div className="d-grid gap-4">
      <div className="d-flex align-items-center justify-content-between">
        <h2 className="h5 mb-0">{draftHeading}</h2>
        <div className="d-flex gap-2">
          <button className="btn btn-secondary" onClick={onBack}>Volver al formulario</button>
          {quedanIntentos && (
            <button className="btn btn-warning" onClick={mejorarInforme} disabled={aiBusy}>
              {aiBusy ? 'Mejorando…' : triesLabel ? `Mejorar informe (${triesLabel})` : 'Mejorar informe'}
            </button>
          )}
          {aiHtml && (
            <button className="btn btn-success" onClick={guardarEnDrive} disabled={!tieneContenido || uploading}>
              {uploading ? 'Guardando…' : 'Guardar en Drive'}
            </button>
          )}
        </div>
      </div>

      {lastUpload?.drive_web_view_link && (
        <div className="alert alert-success mt-2" role="alert">
          Documento guardado en Drive:
          <a
            className="ms-1"
            href={lastUpload.drive_web_view_link}
            target="_blank"
            rel="noreferrer"
          >
            {lastUpload.drive_file_name || 'Abrir documento'}
          </a>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          {/* ===== Datos generales (dos columnas, textos pedidos) ===== */}
          <h5 className="card-title mb-3">{isPreventivo ? preventivoLabels.generales : 'Datos generales'}</h5>
          <div className="row g-3 align-items-stretch">
            {/* Izquierda: Cliente */}
            <div className="col-md-6 d-flex">
              <div className="border rounded p-3 w-100 h-100">
                <h6 className="mb-3">Datos del cliente</h6>
                <div className="row g-2">
                  {!isPreventivoEbro && (
                    <div className="col-12"><strong>Nº Presupuesto:</strong> {dealId || '—'}</div>
                  )}
                <div className="col-12"><strong>Cliente:</strong> {datos?.cliente || '—'}</div>
                {sessionLabel && (
                  <div className="col-md-6 col-12"><strong>Sesión:</strong> {sessionLabel}</div>
                )}
                <div className="col-md-6 col-12"><strong>Persona de contacto:</strong> {datos?.contacto || '—'}</div>
                <div className="col-md-6 col-12"><strong>{direccionSedeLabel}:</strong> {datos?.sede || '—'}</div>
                {!isPreventivoEbro && (
                  <div className="col-md-6 col-12"><strong>Comercial:</strong> {datos?.comercial || '—'}</div>
                )}
                </div>
              </div>
            </div>
            {/* Derecha: Formador / Registro */}
            <div className="col-md-6 d-flex">
              <div className="border rounded p-3 w-100 h-100">
                <h6 className="mb-3">{isPreventivo ? preventivoCard.registro : (isSimulacro ? 'Datos del auditor' : 'Datos del formador')}</h6>
                <div className="row g-2">
                  <div className="col-12">
                    <strong>{isPreventivo ? preventivoCard.bombero : (isSimulacro ? 'Auditor/a' : 'Formador/a')}:</strong> {formador?.nombre || '—'}
                  </div>
                  <div className="col-12">
                    <strong>{isPreventivo ? preventivoCard.fecha : 'Fecha'}:</strong> {datos?.fecha || '—'}
                  </div>
                  <div className="col-12">
                    <strong>Idioma:</strong> {idiomaLabel}
                  </div>
                  {!isPreventivo && (
                    <>
                      <div className="col-12">
                        <strong>Sesiones:</strong> {datos?.sesiones || '—'}
                      </div>
                      <div className="col-12">
                        <strong>Duración (h):</strong> {datos?.duracion || '—'}
                      </div>
                      {!isSimulacro && (
                        <div className="col-12">
                          <strong>Nº de alumnos:</strong> {datos?.alumnos || '—'}
                        </div>
                      )}
                    </>
                  )}
                </div>

              </div>
            </div>
          </div>

          {isSimulacro ? (
            <>
              <hr className="my-4" />
              <h5 className="card-title mb-3 text-danger">DESARROLLO / INCIDENCIAS / RECOMENDACIONES</h5>
              <h5 className="card-title mb-3">Desarrollo</h5>
              <p>{datos?.desarrollo || '—'}</p>
              <h5 className="card-title mb-3">Cronología</h5>
              <ul className="mb-0">
                {(datos?.cronologia || []).map((p, i) => <li key={i}>{p.hora} {p.texto}</li>)}
              </ul>
              {!aiHtml && (
                <>
                  <hr className="my-4" />
                  <h5 className="card-title mb-3">Valoración</h5>
                  <div className="row g-3">
                    <div className="col-md-4"><strong>Participación:</strong> {datos?.escalas?.participacion || '—'}</div>
                    <div className="col-md-4"><strong>Compromiso:</strong> {datos?.escalas?.compromiso || '—'}</div>
                    <div className="col-md-4"><strong>Superación:</strong> {datos?.escalas?.superacion || '—'}</div>
                    <div className="col-md-6"><strong>Incidencias detectadas:</strong> <div>{datos?.comentarios?.c12 || '—'}</div></div>
                    <div className="col-md-6"><strong>Accidentes:</strong> <div>{datos?.comentarios?.c14 || '—'}</div></div>
                    <div className="col-md-4"><strong>Recomendaciones: Formaciones:</strong> <div>{datos?.comentarios?.c15 || '—'}</div></div>
                    <div className="col-md-4"><strong>Recomendaciones: Entorno de trabajo:</strong> <div>{datos?.comentarios?.c16 || '—'}</div></div>
                    <div className="col-md-4"><strong>Recomendaciones: Materiales:</strong> <div>{datos?.comentarios?.c17 || '—'}</div></div>
                    <div className="col-12"><strong>Observaciones generales:</strong> <div>{datos?.comentarios?.c11 || '—'}</div></div>
                  </div>
                </>
              )}
            </>
          ) : isPreventivo ? (
            <>
              <hr className="my-4" />
              {aiHtml ? (
                <>
                  <EditableHtml dealId={dealId} initialHtml={aiHtml} onChange={setAiHtml} />
                </>
              ) : (
                <div className="d-grid gap-3">
                  {preventivoSectionData.map(({ key, label, texto, imagenes }) => {
                    const tieneTexto = (texto || '').trim() !== ''
                    return (
                      <div key={key}>
                        <h5 className="card-title mb-2">{label}</h5>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{tieneTexto ? texto : '—'}</p>
                        {isPreventivoEbro && imagenes.length > 0 && (
                          <div className="mt-2">
                            <div className="small text-muted mb-1">Imágenes de apoyo</div>
                            <div className="d-flex flex-wrap gap-2">
                              {imagenes.map((img, idx) => (
                                <div key={`${key}-img-${idx}`} className="border rounded p-1" style={{ width: 120 }}>
                                  <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                                  <div className="small text-truncate" title={img.name}>{img.name}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <hr className="my-4" />
              <h5 className="card-title mb-3">Formación realizada</h5>
              <p className="mb-2"><strong>Formación:</strong> {datos?.formacionTitulo || '—'}</p>
              <div className="row g-4">
                <div className="col-md-6">
                  <h6>Parte Teórica</h6>
                  <ul className="mb-0">
                    {(datos?.contenidoTeorica || []).map((p, i) => <li key={`t-${i}`}>{p || '—'}</li>)}
                  </ul>
                </div>
                <div className="col-md-6">
                  <h6>Parte Práctica</h6>
                  <ul className="mb-0">
                    {(datos?.contenidoPractica || []).map((p, i) => <li key={`p-${i}`}>{p || '—'}</li>)}
                  </ul>
                </div>
              </div>

              {/* Si no hay IA, mostramos lo literal del formulario */}
              {!aiHtml && (
                <>
                  <hr className="my-4" />
                  <h5 className="card-title mb-3">Valoración y observaciones</h5>
                  <div className="row g-3">
                    <div className="col-md-4"><strong>Participación:</strong> {datos?.escalas?.participacion || '—'}</div>
                    <div className="col-md-4"><strong>Compromiso:</strong> {datos?.escalas?.compromiso || '—'}</div>
                    <div className="col-md-4"><strong>Superación:</strong> {datos?.escalas?.superacion || '—'}</div>
                    <div className="col-md-6"><strong>Puntos fuertes:</strong> <div>{datos?.comentarios?.c11 || '—'}</div></div>
                    <div className="col-md-6"><strong>Asistencia:</strong> <div>{datos?.comentarios?.c12 || '—'}</div></div>
                    <div className="col-md-6"><strong>Puntualidad:</strong> <div>{datos?.comentarios?.c13 || '—'}</div></div>
                    <div className="col-md-6"><strong>Accidentes:</strong> <div>{datos?.comentarios?.c14 || '—'}</div></div>
                    <div className="col-md-4"><strong>Formaciones futuras:</strong> <div>{datos?.comentarios?.c15 || '—'}</div></div>
                    <div className="col-md-4"><strong>Entorno de trabajo:</strong> <div>{datos?.comentarios?.c16 || '—'}</div></div>
                    <div className="col-md-4"><strong>Materiales:</strong> <div>{datos?.comentarios?.c17 || '—'}</div></div>
                  </div>
                </>
              )}
            </>
          )}

          {aiHtml && !isPreventivo && (
            <>
              <hr className="my-4" />
              {/* EDITABLE: guarda en sessionStorage y actualiza aiHtml */}
              <EditableHtml dealId={dealId} initialHtml={aiHtml} onChange={setAiHtml} />
            </>
          )}

          <hr className="my-4" />
          <div>
            <p className="mb-1">Atentamente:</p>
            {bomberosDisplay.map((name, idx) => (
              <div key={`${name}-${idx}`}><strong>{name}</strong></div>
            ))}
            <div className="text-danger">Recurso preventivo GEP</div>
          </div>

          {globalImagesAvailable && (
            <>
              <hr className="my-4" />
              <h5 className="card-title mb-3">Anexos — Imágenes de apoyo</h5>
              <div className="d-flex flex-wrap gap-2">
                {imagenes.map((img, i) => (
                  <div key={i} className="border rounded p-1" style={{ width: 120 }}>
                    <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                    <div className="small text-truncate" title={img.name}>{img.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="d-flex gap-2 justify-content-end">
        <button className="btn btn-secondary" onClick={onBack}>Volver al formulario</button>
        {quedanIntentos && (
          <button className="btn btn-warning" onClick={mejorarInforme} disabled={aiBusy}>
            {aiBusy ? 'Mejorando…' : triesLabel ? `Mejorar informe (${triesLabel})` : 'Mejorar informe'}
          </button>
        )}
        {aiHtml && (
          <button className="btn btn-success" onClick={guardarEnDrive} disabled={!tieneContenido || uploading}>
            {uploading ? 'Guardando…' : 'Guardar en Drive'}
          </button>
        )}
      </div>

      {dealId && !isPreventivoEbro && tries >= maxTries && (
        <div className="text-muted small">
          Has agotado las 3 mejoras para este presupuesto.{' '}
          <button className="btn btn-link p-0 align-baseline" onClick={resetLocalForDeal}>
            Reiniciar intentos (solo pruebas)
          </button>
        </div>
      )}

    </div>
  )
}