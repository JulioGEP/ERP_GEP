import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import plantillasBase from '../utils/plantillas.json'
import { triesKey, htmlKey } from '../utils/keys'

const fileToDataURL = (file) =>
  new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = () => res(reader.result)
    reader.onerror = rej
    reader.readAsDataURL(file)
  })

const preventivoImageKeys = ['trabajos', 'tareas', 'observaciones', 'incidencias']
const createEmptyPreventivoImagenes = () => ({
  trabajos: [],
  tareas: [],
  observaciones: [],
  incidencias: [],
})
const normalizePreventivoImagenes = (value) => {
  const base = createEmptyPreventivoImagenes()
  if (!value) return base
  preventivoImageKeys.forEach((key) => {
    if (Array.isArray(value?.[key])) {
      base[key] = value[key].map((img) => ({ ...img }))
    }
  })
  return base
}
const flattenPreventivoImagenes = (imagenesPorSeccion) => {
  if (!imagenesPorSeccion) return []
  return preventivoImageKeys.flatMap((key) =>
    Array.isArray(imagenesPorSeccion?.[key]) ? imagenesPorSeccion[key].map((img) => ({ ...img })) : []
  )
}

const toTrimmedOrNull = (value) => {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : String(value)
  const trimmed = text.trim()
  return trimmed.length ? trimmed : null
}

const buildSessionLabel = (session) => {
  if (!session) return ''
  const explicit = toTrimmedOrNull(session.label)
  if (explicit) return explicit

  const parts = []
  const number = toTrimmedOrNull(session.number)
  if (number) parts.push(`Sesión ${number}`)

  const nombre = toTrimmedOrNull(session.nombre)
  if (nombre) parts.push(nombre)

  if (!parts.length) {
    const id = toTrimmedOrNull(session.id ? String(session.id) : '')
    if (id) parts.push(`Sesión ${id.slice(0, 8)}`)
  }

  const direccion = toTrimmedOrNull(session.direccion)
  const base = parts.join(' – ')
  return `${base}${direccion ? ` (${direccion})` : ''}`.trim()
}

const sanitizeSessionOption = (session) => {
  if (!session || session.id === null || session.id === undefined) return null

  const id = toTrimmedOrNull(String(session.id))
  if (!id) return null

  const numberRaw = session.number ?? session.numero ?? session.session_number ?? null
  const number = numberRaw !== null && numberRaw !== undefined ? toTrimmedOrNull(String(numberRaw)) : null

  const nombre =
    toTrimmedOrNull(session.nombre) ??
    toTrimmedOrNull(session.nombre_cache) ??
    toTrimmedOrNull(session.name)

  const direccion =
    toTrimmedOrNull(session.direccion) ??
    toTrimmedOrNull(session.address)

  const fecha =
    toTrimmedOrNull(session.fecha) ??
    toTrimmedOrNull(session.fecha_inicio) ??
    toTrimmedOrNull(session.fecha_inicio_utc)

  const label = buildSessionLabel({ id, number, nombre, direccion, label: session.label })

  return { id, number, nombre, direccion, fecha, label }
}

export default function Form({ initial, onNext, title = 'Informe de Formación', onChooseAnother, type = 'formacion' }) {
  const formRef = useRef(null)

  const isSimulacro = type === 'simulacro'
  const isPreventivo = type === 'preventivo' || type === 'preventivo-ebro'
  const isPreventivoEbro = type === 'preventivo-ebro'
  const isFormacion = type === 'formacion'
  const canChooseAnother = typeof onChooseAnother === 'function'
  const direccionSedeLabel = isPreventivo
    ? 'Dirección del Preventivo'
    : isSimulacro
      ? 'Dirección del Simulacro'
      : 'Dirección de la formación'

  const [dealId, setDealId] = useState(() => initial?.dealId || (isPreventivoEbro ? '7331' : ''))
  const prevDealIdRef = useRef(dealId)

  const defaultComentarios = initial?.datos?.comentarios || { c11: '', c12: '', c13: '', c14: '', c15: '', c16: '', c17: '' }
  let preventivoImagenesIniciales = createEmptyPreventivoImagenes()
  if (isPreventivoEbro) {
    preventivoImagenesIniciales = normalizePreventivoImagenes(initial?.datos?.preventivo?.imagenes)
    const tieneImagenesIniciales = flattenPreventivoImagenes(preventivoImagenesIniciales).length > 0
    if (!tieneImagenesIniciales && Array.isArray(initial?.imagenes) && initial.imagenes.length > 0) {
      preventivoImagenesIniciales = {
        ...preventivoImagenesIniciales,
        trabajos: initial.imagenes.map((img) => ({ ...img })),
      }
    }
  }
  const defaultPreventivo = initial?.datos?.preventivo
    ? {
        ...initial.datos.preventivo,
        ...(isPreventivoEbro ? { imagenes: preventivoImagenesIniciales } : {}),
      }
    : {
        trabajos: initial?.datos?.comentarios?.c11 || '',
        tareas: initial?.datos?.comentarios?.c12 || '',
        observaciones: initial?.datos?.comentarios?.c13 || '',
        incidencias: initial?.datos?.comentarios?.c14 || '',
        ...(isPreventivoEbro ? { imagenes: preventivoImagenesIniciales } : {}),
      }

  const [datos, setDatos] = useState(() => ({
    cliente: initial?.datos?.cliente || '',
    sede: initial?.datos?.sede || '',
    contacto: initial?.datos?.contacto || '',
    comercial: initial?.datos?.comercial || '',
    formadorNombre: initial?.datos?.formadorNombre || '',
    idioma: initial?.datos?.idioma || 'ES',
    fecha: initial?.datos?.fecha || '',
    sesiones: initial?.datos?.sesiones ?? 1,
    alumnos: initial?.datos?.alumnos || '',      // numérico en UI
    duracion: initial?.datos?.duracion || '',    // numérico en UI
    formacionTitulo: initial?.datos?.formacionTitulo || '',
    contenidoTeorica: initial?.datos?.contenidoTeorica || [],
    contenidoPractica: initial?.datos?.contenidoPractica || [],
    desarrollo: initial?.datos?.desarrollo || '',
    cronologia: initial?.datos?.cronologia || [],
    escalas: initial?.datos?.escalas || { participacion: 7, compromiso: 7, superacion: 7 },
    comentarios: defaultComentarios,
    preventivo: defaultPreventivo,
  }))

  const [imagenes, setImagenes] = useState(() =>
    isPreventivoEbro ? flattenPreventivoImagenes(preventivoImagenesIniciales) : (initial?.imagenes || [])
  )
  const initialSessionOptionsRaw = Array.isArray(initial?.sessionOptions) ? initial.sessionOptions : []
  const sanitizedInitialOptions = initialSessionOptionsRaw
    .map((session) => sanitizeSessionOption(session))
    .filter(Boolean)
  const initialSessionSanitized = initial?.session
    ? sanitizeSessionOption(initial.session)
    : sanitizedInitialOptions.length === 1
      ? sanitizedInitialOptions[0]
      : null
  const initialOptions = initialSessionSanitized && !sanitizedInitialOptions.some((option) => option.id === initialSessionSanitized.id)
    ? [...sanitizedInitialOptions, initialSessionSanitized]
    : sanitizedInitialOptions
  const [sessionOptions, setSessionOptions] = useState(initialOptions)
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionSanitized?.id || null)
  const sessionSelectRef = useRef(null)
  const [selTitulo, setSelTitulo] = useState(isFormacion ? (datos.formacionTitulo || '') : '')
  const [loadingDeal, setLoadingDeal] = useState(false)
  const dealChangeRef = useRef(true)
  const selectedSession = useMemo(() => {
    if (!sessionOptions.length) return null
    if (selectedSessionId) {
      return sessionOptions.find((s) => s.id === selectedSessionId) || null
    }
    if (sessionOptions.length === 1) return sessionOptions[0]
    return null
  }, [sessionOptions, selectedSessionId])
  const autoPrefillDoneRef = useRef(Boolean(initial?.dealId))

  // Reset de intentos/HTML si cambia el dealId
  useEffect(() => {
    if (prevDealIdRef.current !== dealId) {
      try {
        localStorage.removeItem(triesKey(prevDealIdRef.current))
        sessionStorage.removeItem(htmlKey(prevDealIdRef.current))
      } catch {}
      prevDealIdRef.current = dealId
    }
  }, [dealId])

  useEffect(() => {
    if (dealChangeRef.current) {
      dealChangeRef.current = false
      return
    }
    setSessionOptions([])
    setSelectedSessionId(null)
  }, [dealId])

  useEffect(() => {
    if (sessionOptions.length > 1 && !selectedSessionId && sessionSelectRef.current) {
      sessionSelectRef.current.focus()
    }
  }, [sessionOptions, selectedSessionId])

  // Cargar plantilla al seleccionar formación
  useEffect(() => {
    if (!isFormacion || !selTitulo) return
    const p = plantillasBase[selTitulo]
    setDatos(d => ({
      ...d,
      formacionTitulo: selTitulo,
      contenidoTeorica: p?.teorica || [],
      contenidoPractica: p?.practica || [],
    }))
  }, [selTitulo, isFormacion])

  // Datos del presupuesto / sesión
  const buscarPresupuesto = useCallback(async () => {
    if (!dealId) { alert('Introduce el Nº Presupuesto'); return }
    setLoadingDeal(true)
    try {
      const r = await fetch('/.netlify/functions/reportPrefill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dealId }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'Error al buscar presupuesto')

      const payload = data?.deal || data || {}
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : []
      const normalizedSessions = sessions
        .map((session) => sanitizeSessionOption(session))
        .filter(Boolean)

      const cliente = typeof payload.cliente === 'string' ? payload.cliente : ''
      const contacto = typeof payload.contacto === 'string' ? payload.contacto : ''

      let selected = null
      if (normalizedSessions.length === 1) {
        selected = normalizedSessions[0]
        setSelectedSessionId(selected?.id || null)
      } else {
        setSelectedSessionId(null)
      }

      setSessionOptions(normalizedSessions)

      if (!normalizedSessions.length) {
        alert('No se han encontrado sesiones asociadas a este presupuesto.')
      } else if (normalizedSessions.length > 1) {
        setTimeout(() => {
          if (sessionSelectRef.current) {
            sessionSelectRef.current.focus()
          }
        }, 0)
      }

      setDatos((d) => ({
        ...d,
        cliente: cliente || d.cliente,
        contacto: contacto || d.contacto,
        comercial: '',
        sede: selected?.direccion || (normalizedSessions.length > 1 ? '' : d.sede),
      }))
    } catch (e) {
      console.error(e); alert('No se ha podido obtener el presupuesto.')
    } finally {
      setLoadingDeal(false)
    }
  }, [dealId])

  const handleSessionChange = (event) => {
    const value = event.target.value
    const nextId = value ? String(value) : ''
    const normalized = nextId.trim()
    const resolvedId = normalized.length ? normalized : null
    setSelectedSessionId(resolvedId)
    const found = resolvedId
      ? sessionOptions.find((session) => session.id === resolvedId) || null
      : null
    if (found) {
      setDatos((d) => ({
        ...d,
        sede: typeof found.direccion === 'string' && found.direccion.trim() ? found.direccion : d.sede,
      }))
    } else if (sessionOptions.length) {
      setDatos((d) => ({ ...d, sede: '' }))
    }
  }

  const handleDatePickerOpen = useCallback((event) => {
    const target = event?.target
    if (target && typeof target.showPicker === 'function') {
      try {
        target.showPicker()
      } catch {}
    }
  }, [])

  useEffect(() => {
    if (!isPreventivoEbro) return
    autoPrefillDoneRef.current = true
  }, [isPreventivoEbro])

  // Imágenes (opcional)
  const addImagenes = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const list = [...imagenes]
    for (const f of files) list.push({ name: f.name, dataUrl: await fileToDataURL(f) })
    setImagenes(list)
    try { sessionStorage.setItem('tmpImages', JSON.stringify(list)) } catch {}
    e.target.value = ''
  }
  const removeImagen = (idx) => {
    const list = imagenes.filter((_, i) => i !== idx)
    setImagenes(list)
    try { sessionStorage.setItem('tmpImages', JSON.stringify(list)) } catch {}
  }

  const addPreventivoImagenes = (section) => async (e) => {
    if (!isPreventivoEbro || !preventivoImageKeys.includes(section)) return
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const nuevos = []
    for (const f of files) nuevos.push({ name: f.name, dataUrl: await fileToDataURL(f) })
    let nextImagenesPorSeccion
    setDatos((d) => {
      const prevImagenes = normalizePreventivoImagenes(d.preventivo?.imagenes)
      nextImagenesPorSeccion = {
        ...prevImagenes,
        [section]: [...prevImagenes[section], ...nuevos],
      }
      return {
        ...d,
        preventivo: {
          ...d.preventivo,
          imagenes: nextImagenesPorSeccion,
        },
      }
    })
    if (nextImagenesPorSeccion) {
      const flatten = flattenPreventivoImagenes(nextImagenesPorSeccion)
      setImagenes(flatten)
      try { sessionStorage.setItem('tmpImages', JSON.stringify(flatten)) } catch {}
    }
    e.target.value = ''
  }

  const removePreventivoImagen = (section, idx) => {
    if (!isPreventivoEbro || !preventivoImageKeys.includes(section)) return
    let nextImagenesPorSeccion
    setDatos((d) => {
      const prevImagenes = normalizePreventivoImagenes(d.preventivo?.imagenes)
      nextImagenesPorSeccion = {
        ...prevImagenes,
        [section]: prevImagenes[section].filter((_, i) => i !== idx),
      }
      return {
        ...d,
        preventivo: {
          ...d.preventivo,
          imagenes: nextImagenesPorSeccion,
        },
      }
    })
    if (nextImagenesPorSeccion) {
      const flatten = flattenPreventivoImagenes(nextImagenesPorSeccion)
      setImagenes(flatten)
      try { sessionStorage.setItem('tmpImages', JSON.stringify(flatten)) } catch {}
    }
  }

  const getPreventivoImagenes = (section) => {
    if (!preventivoImageKeys.includes(section)) return []
    const arr = datos?.preventivo?.imagenes?.[section]
    return Array.isArray(arr) ? arr : []
  }

  // Cronología para simulacros
  const addCrono = () => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    setDatos(d => ({ ...d, cronologia: [...(d.cronologia||[]), { hora: `${hh}:${mm}`, texto: '' }] }))
  }

  const updateCrono = (idx, field, value) => {
    setDatos(d => {
      const arr = [...(d.cronologia || [])]
      arr[idx] = { ...arr[idx], [field]: value }
      return { ...d, cronologia: arr }
    })
  }

  const removeCrono = (idx) => setDatos(d => ({ ...d, cronologia: d.cronologia.filter((_, i) => i !== idx) }))

  // Submit con validación nativa + min
  const onSubmit = (e) => {
    e.preventDefault()
    // Deja que el navegador valide los `required`, `min`, etc.
    if (formRef.current && !formRef.current.reportValidity()) return

    if (!dealId) {
      alert('El Nº de presupuesto es obligatorio.')
      return
    }

    if (!isPreventivoEbro && !selectedSession) {
      if (sessionSelectRef.current) {
        sessionSelectRef.current.focus()
      }
      return
    }

    // Validación extra saneando números (por si acaso)
    const numOk = (v) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0
    }

    if ((isSimulacro || isFormacion) && !numOk(datos.sesiones)) {
      alert('Los campos numéricos deben ser mayores que 0.')
      return
    }
    if (isFormacion && !numOk(datos.alumnos)) {
      alert('Los campos numéricos deben ser mayores que 0.')
      return
    }
    if ((isSimulacro || isFormacion) && !numOk(datos.duracion)) {
      alert('Los campos numéricos deben ser mayores que 0.')
      return
    }

    if (!datos.fecha) {
      alert('La fecha es obligatoria.')
      return
    }

    const nextDatos = {
      ...datos,
      tipo: type,
      comentarios: isPreventivo
        ? {
            ...datos.comentarios,
            c11: datos.preventivo?.trabajos || '',
            c12: datos.preventivo?.tareas || '',
            c13: datos.preventivo?.observaciones || '',
            c14: datos.preventivo?.incidencias || '',
            c15: '',
            c16: '',
            c17: '',
          }
        : datos.comentarios,
    }

    const finalImagenes = isPreventivoEbro
      ? flattenPreventivoImagenes(nextDatos.preventivo?.imagenes)
      : imagenes
    onNext({
      type,
      dealId,
      formador: { nombre: datos.formadorNombre, idioma: datos.idioma },
      datos: nextDatos,
      imagenes: finalImagenes,
      session: selectedSession || null,
      sessionOptions,
    })
  }

  const addTeorica = () => setDatos(d => ({ ...d, contenidoTeorica: [...(d.contenidoTeorica||[]), '' ] }))
  const addPractica = () => setDatos(d => ({ ...d, contenidoPractica: [...(d.contenidoPractica||[]), '' ] }))

  const opcionesOrdenadas = useMemo(() =>
    Object.keys(plantillasBase).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}))
  , [])

  let mainSection
  if (isSimulacro) {
    mainSection = (
      <>
        <h2 className="h5 text-danger">DESARROLLO / INCIDENCIAS / RECOMENDACIONES</h2>
        <div className="mb-3">
          <label className="form-label">Desarrollo</label>
          <textarea className="form-control" required value={datos.desarrollo} onChange={(e)=>setDatos(d=>({...d, desarrollo:e.target.value}))} />
        </div>
        <div>
          <h2 className="h5">Cronología</h2>
          <div className="card"><div className="card-body">
            <label className="form-label">Inicio del Simulacro</label>
            <div className="d-grid gap-2">
              {(datos.cronologia || []).map((p,i)=>(
                <div className="input-group" key={i}>
                  <input
                    type="time"
                    className="form-control"
                    value={p.hora}
                    required
                    onChange={(e)=>updateCrono(i,'hora',e.target.value)}
                    style={{ flex: '0 0 120px', maxWidth: 120 }}
                  />
                  <input
                    className="form-control"
                    value={p.texto}
                    required
                    onChange={(e)=>updateCrono(i,'texto',e.target.value)}
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                  />
                  <button type="button" className="btn btn-outline-danger" onClick={()=>removeCrono(i)}>Eliminar</button>
                </div>
              ))}
              <button type="button" className="btn btn-outline-primary" onClick={addCrono}>Añadir punto</button>
            </div>
            <div className="form-text mt-2">Añade punto a punto la cronología de lo que sucede en el simulacro</div>
          </div></div>
        </div>
      </>
    )
  } else if (isPreventivo) {
    const trabajosImagenes = getPreventivoImagenes('trabajos')
    const tareasImagenes = getPreventivoImagenes('tareas')
    const observacionesImagenes = getPreventivoImagenes('observaciones')
    const incidenciasImagenes = getPreventivoImagenes('incidencias')
    mainSection = (
      <div>
        <h2 className="h5">Informe de preventivos</h2>
        <div className="card">
          <div className="card-body d-grid gap-4">
            <div>
              <label className="form-label">Trabajos</label>
              <textarea
                className="form-control"
                required
                rows={8}
                value={datos.preventivo?.trabajos || ''}
                onChange={(e)=>setDatos(d=>({
                  ...d,
                  preventivo: { ...d.preventivo, trabajos: e.target.value },
                }))}
              />
              <div className="form-text">Describe el trabajo que nos han pedido realizar.</div>
              {isPreventivoEbro && (
                <div className="mt-3">
                  <label className="form-label">Imágenes de apoyo (opcional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="form-control"
                    onChange={addPreventivoImagenes('trabajos')}
                  />
                  {trabajosImagenes.length > 0 && (
                    <div className="mt-2 d-flex flex-wrap gap-2">
                      {trabajosImagenes.map((img, idx) => (
                        <div key={idx} className="border rounded p-1" style={{ width: 120 }}>
                          <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                          <div className="d-flex justify-content-between align-items-center mt-1">
                            <small className="text-truncate" style={{ maxWidth: 80 }} title={img.name}>{img.name}</small>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => removePreventivoImagen('trabajos', idx)}
                            >
                              x
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="form-text">Se añadirán al informe justo después de esta sección.</div>
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Tareas</label>
              <textarea
                className="form-control"
                required
                rows={8}
                value={datos.preventivo?.tareas || ''}
                onChange={(e)=>setDatos(d=>({
                  ...d,
                  preventivo: { ...d.preventivo, tareas: e.target.value },
                }))}
              />
              <div className="form-text">Describe las tareas realizadas en función de los trabajos que teníamos que hacer.</div>
              {isPreventivoEbro && (
                <div className="mt-3">
                  <label className="form-label">Imágenes de apoyo (opcional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="form-control"
                    onChange={addPreventivoImagenes('tareas')}
                  />
                  {tareasImagenes.length > 0 && (
                    <div className="mt-2 d-flex flex-wrap gap-2">
                      {tareasImagenes.map((img, idx) => (
                        <div key={idx} className="border rounded p-1" style={{ width: 120 }}>
                          <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                          <div className="d-flex justify-content-between align-items-center mt-1">
                            <small className="text-truncate" style={{ maxWidth: 80 }} title={img.name}>{img.name}</small>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => removePreventivoImagen('tareas', idx)}
                            >
                              x
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="form-text">Se añadirán al informe justo después de esta sección.</div>
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Observaciones</label>
              <textarea
                className="form-control"
                required
                rows={8}
                value={datos.preventivo?.observaciones || ''}
                onChange={(e)=>setDatos(d=>({
                  ...d,
                  preventivo: { ...d.preventivo, observaciones: e.target.value },
                }))}
              />
              {isPreventivoEbro && (
                <div className="mt-3">
                  <label className="form-label">Imágenes de apoyo (opcional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="form-control"
                    onChange={addPreventivoImagenes('observaciones')}
                  />
                  {observacionesImagenes.length > 0 && (
                    <div className="mt-2 d-flex flex-wrap gap-2">
                      {observacionesImagenes.map((img, idx) => (
                        <div key={idx} className="border rounded p-1" style={{ width: 120 }}>
                          <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                          <div className="d-flex justify-content-between align-items-center mt-1">
                            <small className="text-truncate" style={{ maxWidth: 80 }} title={img.name}>{img.name}</small>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => removePreventivoImagen('observaciones', idx)}
                            >
                              x
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="form-text">Se añadirán al informe justo después de esta sección.</div>
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Incidencias</label>
              <textarea
                className="form-control"
                required
                rows={8}
                value={datos.preventivo?.incidencias || ''}
                onChange={(e)=>setDatos(d=>({
                  ...d,
                  preventivo: { ...d.preventivo, incidencias: e.target.value },
                }))}
              />
              {isPreventivoEbro && (
                <div className="mt-3">
                  <label className="form-label">Imágenes de apoyo (opcional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="form-control"
                    onChange={addPreventivoImagenes('incidencias')}
                  />
                  {incidenciasImagenes.length > 0 && (
                    <div className="mt-2 d-flex flex-wrap gap-2">
                      {incidenciasImagenes.map((img, idx) => (
                        <div key={idx} className="border rounded p-1" style={{ width: 120 }}>
                          <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                          <div className="d-flex justify-content-between align-items-center mt-1">
                            <small className="text-truncate" style={{ maxWidth: 80 }} title={img.name}>{img.name}</small>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => removePreventivoImagen('incidencias', idx)}
                            >
                              x
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="form-text">Se añadirán al informe justo después de esta sección.</div>
                </div>
              )}
            </div>
            {!isPreventivoEbro && (
              <div>
                <label className="form-label">Imágenes de apoyo (opcional)</label>
                <input type="file" accept="image/*" multiple className="form-control" onChange={addImagenes} />
                {imagenes.length > 0 && (
                  <div className="mt-2 d-flex flex-wrap gap-2">
                    {imagenes.map((img, idx) => (
                      <div key={idx} className="border rounded p-1" style={{ width: 120 }}>
                        <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                        <div className="d-flex justify-content-between align-items-center mt-1">
                          <small className="text-truncate" style={{ maxWidth: 80 }} title={img.name}>{img.name}</small>
                          <button type="button" className="btn btn-sm btn-outline-danger" onClick={()=>removeImagen(idx)}>x</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="form-text">Se añadirán al final del informe bajo “Imágenes de apoyo”.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  } else {
    mainSection = (
      <div>
        <h2 className="h5">Formación realizada</h2>
        <div className="card"><div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Formación</label>
              <select
                className="form-select"
                value={selTitulo}
                required
                onChange={(e)=>setSelTitulo(e.target.value)}
              >
                <option value="">— Selecciona —</option>
                {opcionesOrdenadas.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="row g-4 mt-1">
            <div className="col-md-6">
              <label className="form-label">Parte Teórica</label>
              <div className="d-grid gap-2">
                {(datos.contenidoTeorica || []).map((v,i)=>(
                  <div className="input-group" key={`t-${i}`}>
                    <input className="form-control" value={v}
                      onChange={(e)=>setDatos(d=>{ const arr=[...(d.contenidoTeorica||[])]; arr[i]=e.target.value; return {...d, contenidoTeorica:arr}; })} />
                    <button type="button" className="btn btn-outline-danger" onClick={()=>setDatos(d=>({...d, contenidoTeorica:d.contenidoTeorica.filter((_,idx)=>idx!==i)}))}>Eliminar</button>
                  </div>
                ))}
                <button type="button" className="btn btn-outline-primary" onClick={addTeorica}>Añadir punto</button>
              </div>
            </div>

            <div className="col-md-6">
              <label className="form-label">Parte Práctica</label>
              <div className="d-grid gap-2">
                {(datos.contenidoPractica || []).map((v,i)=>(
                  <div className="input-group" key={`p-${i}`}>
                    <input className="form-control" value={v}
                      onChange={(e)=>setDatos(d=>{ const arr=[...(d.contenidoPractica||[])]; arr[i]=e.target.value; return {...d, contenidoPractica:arr}; })} />
                    <button type="button" className="btn btn-outline-danger" onClick={()=>setDatos(d=>({...d, contenidoPractica:d.contenidoPractica.filter((_,idx)=>idx!==i)}))}>Eliminar</button>
                  </div>
                ))}
                <button type="button" className="btn btn-outline-primary" onClick={addPractica}>Añadir punto</button>
              </div>
            </div>
          </div>

          <div className="form-text mt-2">
            Selecciona la formación realizada. Se añadirán sus “Parte teórica” y “Parte práctica” al borrador. Si falta algún punto, añádelo.
          </div>
        </div></div>
      </div>
    )
  }


  return (
    <form ref={formRef} className="d-grid gap-4" onSubmit={onSubmit}>
      <h1 className="h5 my-3">{title}</h1>

      {canChooseAnother && (
        <div className="d-flex justify-content-end mb-2">
          <button type="button" className="btn btn-secondary" onClick={onChooseAnother}>
            Elegir otro informe
          </button>
        </div>
      )}

      {/* ===== Cliente + Formador en 2 columnas ===== */}
      <div className="row g-3 align-items-stretch">
        {/* DATOS DEL CLIENTE */}
        <div className="col-md-6 d-flex">
          <div className="card w-100 h-100">
            <div className="card-body">
              <h2 className="h6">Datos del cliente</h2>

              {isPreventivoEbro ? (
                <input type="hidden" value={dealId} readOnly />
              ) : (
                <div className="row g-2 align-items-end">
                  <div className="col-12 col-md-4 col-lg-5">
                    <label className="form-label">Nº Presupuesto</label>
                    <input
                      className="form-control form-control-sm"
                      value={dealId}
                      required
                      onChange={(e)=>setDealId(e.target.value)}
                    />
                  </div>
                  <div className="col-6 col-md-3 col-lg-2">
                    <label className="form-label d-md-none">&nbsp;</label>
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm w-100"
                      onClick={buscarPresupuesto}
                      disabled={loadingDeal}
                    >
                      {loadingDeal ? 'Buscando…' : 'Buscar'}
                    </button>
                  </div>
                  {sessionOptions.length > 0 && (
                    <div className="col-12 col-md-5 col-lg-5">
                      <label className="form-label">Sesión</label>
                      <select
                        ref={sessionSelectRef}
                        className="form-select form-select-sm"
                        value={selectedSessionId || ''}
                        onChange={handleSessionChange}
                        required
                        disabled={sessionOptions.length === 1 && Boolean(selectedSessionId)}
                      >
                        {sessionOptions.length > 1 && <option value="">Selecciona una sesión…</option>}
                        {sessionOptions.map((session) => (
                          <option key={session.id} value={session.id}>
                            {buildSessionLabel(session)}
                          </option>
                        ))}
                      </select>
                      <div className="form-text">Se usará su dirección para rellenar el informe.</div>
                    </div>
                  )}
                </div>
              )}

              <div className="row g-3 mt-1">
                <div className="col-md-7">
                  <label className="form-label">Cliente</label>
                  <input className="form-control" value={datos.cliente} required onChange={(e)=>setDatos(d=>({...d, cliente:e.target.value}))} />
                </div>
                {!isPreventivoEbro && (
                  <div className="col-md-6">
                    <label className="form-label">Comercial</label>
                    <input className="form-control" value={datos.comercial} required onChange={(e)=>setDatos(d=>({...d, comercial:e.target.value}))} />
                  </div>
                )}
                <div className="col-md-6">
                  <label className="form-label">Persona de contacto</label>
                  <input className="form-control" value={datos.contacto} required onChange={(e)=>setDatos(d=>({...d, contacto:e.target.value}))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">{direccionSedeLabel}</label>
                  <input className="form-control" value={datos.sede} required onChange={(e)=>setDatos(d=>({...d, sede:e.target.value}))} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* DATOS DEL FORMADOR / REGISTRO */}
        <div className="col-md-6 d-flex">
          <div className="card w-100 h-100">
            <div className="card-body">
              <h2 className="h6">{isPreventivo ? 'Registro' : (isSimulacro ? 'Datos del auditor' : 'Datos del formador')}</h2>

              <div className="row g-3">
                {/* Formador/a o Auditor/a */}
                <div className="col-12">
                  <label className="form-label">{isPreventivo ? 'Bombero/a' : (isSimulacro ? 'Auditor/a' : 'Formador/a')}</label>
                  <input className="form-control" value={datos.formadorNombre} required onChange={(e)=>setDatos(d=>({...d, formadorNombre:e.target.value}))} />
                </div>

                {/* Idioma del informe */}
                <div className="col-12 col-md-6">
                  <label className="form-label">Idioma del informe</label>
                  <select className="form-select" value={datos.idioma} required onChange={(e)=>setDatos(d=>({...d, idioma:e.target.value}))}>
                    <option value="ES">Castellano</option>
                    <option value="CA">Català</option>
                    <option value="EN">English</option>
                  </select>
                </div>

                {/* Fecha */}
                <div className="col-12 col-md-6">
                  <label className="form-label">{isPreventivo ? 'Fecha ejercicio' : 'Fecha'}</label>
                  <input
                    type="date"
                    className="form-control"
                    value={datos.fecha}
                    required
                    onChange={(e)=>setDatos(d=>({...d, fecha:e.target.value}))}
                    onClick={handleDatePickerOpen}
                    onFocus={handleDatePickerOpen}
                  />
                </div>

                {!isPreventivo && (
                  <>
                    <div className="col-12 col-md-6">
                      <label className="form-label">Sesiones</label>
                      <input
                        type="number"
                        min={1}
                        className="form-control"
                        value={datos.sesiones}
                        required
                        onChange={(e)=>setDatos(d=>({...d, sesiones:Number(e.target.value||1)}))}
                      />
                    </div>

                    {!isSimulacro && (
                      <div className="col-12 col-md-6">
                        <label className="form-label">Nº de alumnos</label>
                        <input
                          type="number"
                          min={1}
                          className="form-control"
                          value={datos.alumnos}
                          required={!isSimulacro}
                          onChange={(e)=>setDatos(d=>({...d, alumnos:e.target.value}))}
                        />
                      </div>
                    )}

                    <div className="col-12 col-md-6">
                      <label className="form-label">Duración (horas)</label>
                      <input
                        type="number"
                        min={1}
                        step="0.5"
                        className="form-control"
                        value={datos.duracion}
                        required
                        onChange={(e)=>setDatos(d=>({...d, duracion:e.target.value}))}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {mainSection}

      {!isPreventivo && (
        <div>
          <h2 className="h5">Valoración</h2>
          <div className="card"><div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <div className="input-group">
                <span className="input-group-text">Participación</span>
                <input
                  type="number" min={1} max={10} className="form-control" required
                  value={datos.escalas.participacion}
                  onChange={(e)=>setDatos(d=>({...d, escalas:{...d.escalas, participacion:Number(e.target.value||0)}}))}
                />
              </div>
            </div>
            <div className="col-md-4">
              <div className="input-group">
                <span className="input-group-text">Compromiso</span>
                <input
                  type="number" min={1} max={10} className="form-control" required
                  value={datos.escalas.compromiso}
                  onChange={(e)=>setDatos(d=>({...d, escalas:{...d.escalas, compromiso:Number(e.target.value||0)}}))}
                />
              </div>
            </div>
            <div className="col-md-4">
              <div className="input-group">
                <span className="input-group-text">Superación</span>
                <input
                  type="number" min={1} max={10} className="form-control" required
                  value={datos.escalas.superacion}
                  onChange={(e)=>setDatos(d=>({...d, escalas:{...d.escalas, superacion:Number(e.target.value||0)}}))}
                />
              </div>
            </div>

            {/* Comentarios */}
            {isSimulacro ? (
              <>
                <div className="col-md-6">
                  <label className="form-label">Incidencias detectadas</label>
                  <textarea className="form-control" required value={datos.comentarios.c12}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c12:e.target.value}}))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Incidencias: Accidentes</label>
                  <textarea className="form-control" required value={datos.comentarios.c14}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c14:e.target.value}}))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Recomendaciones: Formaciones</label>
                  <textarea className="form-control" required value={datos.comentarios.c15}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c15:e.target.value}}))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Recomendaciones: Del entorno de Trabajo</label>
                  <textarea className="form-control" required value={datos.comentarios.c16}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c16:e.target.value}}))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Recomendaciones: De Materiales</label>
                  <textarea className="form-control" required value={datos.comentarios.c17}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c17:e.target.value}}))} />
                </div>
                <div className="col-12">
                  <label className="form-label">Observaciones generales</label>
                  <textarea className="form-control" required value={datos.comentarios.c11}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c11:e.target.value}}))} />
                </div>
              </>
            ) : (
              <>
                <div className="col-md-6">
                  <label className="form-label">Puntos fuertes de los alumnos a destacar</label>
                  <textarea className="form-control" required value={datos.comentarios.c11}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c11:e.target.value}}))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Incidencias: Referentes a la asistencia</label>
                  <textarea className="form-control" required value={datos.comentarios.c12}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c12:e.target.value}}))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Incidencias: Referentes a la puntualidad</label>
                  <textarea className="form-control" required value={datos.comentarios.c13}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c13:e.target.value}}))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Incidencias: Accidentes</label>
                  <textarea className="form-control" required value={datos.comentarios.c14}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c14:e.target.value}}))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Recomendaciones: Formaciones Futuras</label>
                  <textarea className="form-control" required value={datos.comentarios.c15}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c15:e.target.value}}))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Recomendaciones: Del entorno de Trabajo</label>
                  <textarea className="form-control" required value={datos.comentarios.c16}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c16:e.target.value}}))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Recomendaciones: De Materiales</label>
                  <textarea className="form-control" required value={datos.comentarios.c17}
                    onChange={(e)=>setDatos(d=>({...d, comentarios:{...d.comentarios, c17:e.target.value}}))} />
                </div>
              </>
            )}

            {/* Imágenes (opcional) */}
            {!isPreventivoEbro && (
              <div className="col-12">
                <label className="form-label">Imágenes de apoyo (opcional)</label>
                <input type="file" accept="image/*" multiple className="form-control" onChange={addImagenes} />
                {imagenes.length > 0 && (
                  <div className="mt-2 d-flex flex-wrap gap-2">
                    {imagenes.map((img, idx) => (
                      <div key={idx} className="border rounded p-1" style={{ width: 120 }}>
                        <img src={img.dataUrl} alt={img.name} className="img-fluid rounded" />
                        <div className="d-flex justify-content-between align-items-center mt-1">
                          <small className="text-truncate" style={{ maxWidth: 80 }} title={img.name}>{img.name}</small>
                          <button type="button" className="btn btn-sm btn-outline-danger" onClick={()=>removeImagen(idx)}>x</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="form-text">Se añadirán al final del informe bajo “Imágenes de apoyo”.</div>
              </div>
            )}
          </div>
        </div></div>
        </div>
      )}

      <div className="d-flex justify-content-between">
        {canChooseAnother ? (
          <button type="button" className="btn btn-secondary" onClick={onChooseAnother}>Elegir otro informe</button>
        ) : <span />}
        <button type="submit" className="btn btn-primary">Siguiente</button>
      </div>
    </form>
  )
}