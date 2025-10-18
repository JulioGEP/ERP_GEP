import React, { useEffect, useMemo, useRef, useState } from 'react'
import logoImg from '../assets/logo-nuevo.png'
import { generateReportPdfmake } from '../pdf/reportPdfmake'
import { triesKey, htmlKey } from '../utils/keys'
import SendEmailModal from './SendEmailModal'

let warnedMissingReportsToken = false
const getReportsAuthHeaders = () => {
  const token = import.meta.env.VITE_REPORTS_API_TOKEN
  if (!token) {
    if (!warnedMissingReportsToken) {
      console.warn('VITE_REPORTS_API_TOKEN no está configurado; las peticiones a Netlify serán rechazadas.')
      warnedMissingReportsToken = true
    }
    return {}
  }
  return { Authorization: `Bearer ${token}` }
}

const maxTries = 3

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
  const { datos, imagenes, formador, dealId, type: draftType } = draft
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
  const bomberosRaw = (formador?.nombre || '').trim()
  const bomberosList = bomberosRaw
    ? bomberosRaw.split(/\s*(?:[,;]|\r?\n)+\s*/).map((name) => name.trim()).filter(Boolean)
    : []
  const bomberosDisplay = bomberosList.length ? bomberosList : bomberosRaw ? [bomberosRaw] : ['—']

  const [aiHtml, setAiHtml] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const [pdfForModal, setPdfForModal] = useState(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailStatus, setEmailStatus] = useState(null)

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
      setTries(0); setAiHtml(null); setPdfForModal(null); setShowEmailModal(false); setEmailStatus(null)
    }
  }, [dealId])

  useEffect(() => {
    if (!pdfForModal) {
      setShowEmailModal(false)
      setEmailStatus(null)
    }
  }, [pdfForModal])

  const resetLocalForDeal = () => {
    try {
      localStorage.removeItem(triesKey(dealId))
      sessionStorage.removeItem(htmlKey(dealId))
    } catch {}
    setTries(0); setAiHtml(null); setPdfForModal(null); setShowEmailModal(false); setEmailStatus(null)
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
        headers: { 'Content-Type': 'application/json', ...getReportsAuthHeaders() },
        body: JSON.stringify({ formador, datos: stripImagesFromDatos(datos) }),
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
        const next = isPreventivoEbro ? tries + 1 : Math.min(tries + 1, maxTries)
        setTries(next)
        try { localStorage.setItem(triesKey(dealId), String(next)) } catch {}
      }
    } catch (e) {
      console.error(e)
      const message = e?.message ? `No se ha podido mejorar el informe.\n${e.message}` : 'No se ha podido mejorar el informe.'
      alert(message)
    } finally {
      setAiBusy(false)
    }
  }

  const stripHtml = (html) => (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()

  const descargarPDF = async () => {
    try {
      const result = await generateReportPdfmake({ dealId, datos, formador, imagenes, type })
      setPdfForModal(result)
      setEmailStatus(null)
      return result
    } catch (e) {
      console.error('Error generando PDF (pdfmake):', e)
      alert('No se ha podido generar el PDF.')
    }
  }
  const descargarPDFyEnviar = async () => {
    const pdf = await descargarPDF()
    if (pdf) {
      setShowEmailModal(true)
    }
  }

  const handleEmailSuccess = (info) => {
    setShowEmailModal(false)
    if (info && Array.isArray(info.to)) {
      setEmailStatus({
        to: info.to,
        cc: info.cc || [],
        bcc: info.bcc || [],
        timestamp: Date.now(),
      })
    } else {
      setEmailStatus(null)
    }
  }
  const triesLabel = isPreventivoEbro ? null : `${dealId ? tries : 0}/${maxTries}`
  const quedanIntentos = !dealId || isPreventivoEbro || tries < maxTries

  return (
    <div className="d-grid gap-4">
      {/* Header con margen superior e inferior simétrico */}
      <div
        className="border-bottom d-flex align-items-center gap-3 sticky-top bg-white py-3 my-3"
        style={{ top: 0, zIndex: 10 }}
      >
        <img
          src={logoImg}
          alt="GEP Group"
          style={{ width: 180, height: 52, objectFit: 'contain', display: 'block' }}
        />
        <div className="flex-grow-1">
          <h1 className="h5 mb-0">{title}</h1>
          <small className="text-muted">GEP Group — Formación y Servicios</small>
        </div>
      </div>

      <div className="d-flex align-items-center justify-content-between">
        <h2 className="h5 mb-0">Borrador del informe</h2>
        <div className="d-flex gap-2">
          <button className="btn btn-secondary" onClick={onBack}>Volver al formulario</button>
          {quedanIntentos && (
            <button className="btn btn-warning" onClick={mejorarInforme} disabled={aiBusy}>
              {aiBusy ? 'Mejorando…' : triesLabel ? `Mejorar informe (${triesLabel})` : 'Mejorar informe'}
            </button>
          )}
          {aiHtml && (
            <button className="btn btn-success" onClick={descargarPDFyEnviar} disabled={!tieneContenido}>
              Descargar PDF y Enviar
            </button>
          )}
        </div>
      </div>

      {emailStatus && (
        <div className="alert alert-success" role="status">
          Informe enviado correctamente a {emailStatus.to.join(', ')}.
          {emailStatus.cc.length > 0 && (
            <span> CC: {emailStatus.cc.join(', ')}.</span>
          )}
          {emailStatus.bcc.length > 0 && (
            <span> CCO: {emailStatus.bcc.join(', ')}.</span>
          )}
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
                  <div className="col-md-7"><strong>Cliente:</strong> {datos?.cliente || '—'}</div>
                  <div className="col-md-5"><strong>CIF:</strong> {datos?.cif || '—'}</div>
                  {!isPreventivoEbro && (
                    <div className="col-md-6"><strong>Dirección fiscal:</strong> {datos?.direccionOrg || '—'}</div>
                  )}
                  <div className="col-md-6"><strong>{direccionSedeLabel}:</strong> {datos?.sede || '—'}</div>
                  <div className="col-md-6"><strong>Persona de contacto:</strong> {datos?.contacto || '—'}</div>
                  {!isPreventivoEbro && (
                    <div className="col-md-6"><strong>Comercial:</strong> {datos?.comercial || '—'}</div>
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
          <button className="btn btn-success" onClick={descargarPDFyEnviar} disabled={!tieneContenido}>
            Descargar PDF y Enviar
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

      <SendEmailModal
        show={showEmailModal && Boolean(pdfForModal)}
        onClose={() => setShowEmailModal(false)}
        onSuccess={handleEmailSuccess}
        pdf={pdfForModal}
        draft={{ ...draft, type }}
        title={title}
      />
    </div>
  )
}