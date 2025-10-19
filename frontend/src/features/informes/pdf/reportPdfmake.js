import headerImg from '../assets/pdf/header.png'
import footerImg from '../assets/pdf/footer.png'

// Fuentes locales (sin CORS/CDN)
import PoppinsRegular   from '../assets/fonts/Poppins-Regular.ttf'
import PoppinsBold      from '../assets/fonts/Poppins-Bold.ttf'
import PoppinsSemiBold  from '../assets/fonts/Poppins-SemiBold.ttf'
import { htmlKey } from '../utils/keys'

// ---------- utils ----------
const toDataURL = async (url) => {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = (e) => reject(e)
    document.head.appendChild(s)
  })

async function ensurePdfMake() {
  if (window.pdfMake?.createPdf) return window.pdfMake
  const ver = '0.2.12'
  await loadScript(`https://cdn.jsdelivr.net/npm/pdfmake@${ver}/build/pdfmake.min.js`)
  await loadScript(`https://cdn.jsdelivr.net/npm/pdfmake@${ver}/build/vfs_fonts.js`)
  if (!window.pdfMake?.createPdf) throw new Error('No se pudo cargar pdfmake')
  return window.pdfMake
}

async function ensureHtmlToPdfMake() {
  if (window.htmlToPdfmake) return window.htmlToPdfmake
  const ver = '2.5.5'
  await loadScript(`https://cdn.jsdelivr.net/npm/html-to-pdfmake@${ver}/browser.js`)
  if (!window.htmlToPdfmake) throw new Error('No se pudo cargar html-to-pdfmake')
  return window.htmlToPdfmake
}

// Cargar Poppins desde assets locales (Regular, Bold, SemiBold)
async function ensurePoppinsFont(pdfMake) {
  if (pdfMake.fonts && pdfMake.fonts.Poppins) return

  const toBase64 = async (assetUrl) => {
    const res = await fetch(assetUrl, { cache: 'force-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${assetUrl}`)
    const buf = await res.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  pdfMake.vfs = pdfMake.vfs || {}

  try {
    const [reg, bold, semibold] = await Promise.all([
      toBase64(PoppinsRegular),
      toBase64(PoppinsBold),
      toBase64(PoppinsSemiBold),
    ])

    pdfMake.vfs['Poppins-Regular.ttf']   = reg
    pdfMake.vfs['Poppins-Bold.ttf']      = bold
    pdfMake.vfs['Poppins-SemiBold.ttf']  = semibold

    // No tenemos variantes itálicas → las mapeamos a regular/bold para evitar errores
    pdfMake.fonts = {
      ...(pdfMake.fonts || {}),
      Poppins: {
        normal:      'Poppins-Regular.ttf',
        bold:        'Poppins-Bold.ttf',
        italics:     'Poppins-Regular.ttf',
        bolditalics: 'Poppins-Bold.ttf',
      },
    }
  } catch (e) {
    console.warn('No se pudo cargar Poppins local; se usará la fuente por defecto.', e)
  }
}

const bullet = (items) =>
  (items || [])
    .filter((s) => (s || '').trim())
    .map((s) => s.trim())

const kv = (label, value) => [{ text: `${label}: `, bold: true }, { text: value || '—' }]

const chunk = (arr = [], size = 2) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const preventivoImageKeys = ['trabajos', 'tareas', 'observaciones', 'incidencias']
const normalizePreventivoImagenes = (value) => {
  const result = {}
  preventivoImageKeys.forEach((key) => {
    const list = value?.[key]
    result[key] = Array.isArray(list) ? list.map((img) => ({ ...img })) : []
  })
  return result
}
const flattenPreventivoImagenes = (imagenesPorSeccion) =>
  preventivoImageKeys.flatMap((key) =>
    Array.isArray(imagenesPorSeccion?.[key]) ? imagenesPorSeccion[key] : []
  )
const buildImageRows = (imagenes = []) =>
  chunk(imagenes || [], 2).map((row) => ({
    columns: row.map((img) => ({
      stack: [
        { image: img.dataUrl, width: 220, margin: [0, 0, 0, 4] },
        { text: img.name || '', style: 'caption' },
      ],
    })),
    columnGap: 10,
    margin: [0, 6, 0, 6],
  }))

const stripHtml = (html) =>
  (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()

const multilineToParagraphs = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return [{ text: '—', color: '#666' }]

  const paragraphs = raw
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\r?\n/g, '\n').trim())
    .filter(Boolean)

  if (!paragraphs.length) {
    return [{ text: raw.replace(/\r?\n/g, '\n'), margin: [0, 0, 0, 0] }]
  }

  return paragraphs.map((paragraph, index) => ({
    text: paragraph,
    margin: [0, 0, 0, index === paragraphs.length - 1 ? 0 : 6],
  }))
}

const footerSimulacro = () => ({
  margin: [58, 0, 58, 18],
  stack: [
    {
      table: {
        widths: ['*', '*', '*'],
        body: [
          [
            {
              stack: [
                { text: 'BARCELONA', color: '#E1062C', bold: true, fontSize: 9 },
                { text: 'C. Moratín, 100 · 08206 Sabadell · Barcelona', fontSize: 8 },
                { text: 'Tel. +34 935 604 636', fontSize: 8 },
              ],
            },
            {
              stack: [
                { text: 'MADRID', color: '#E1062C', bold: true, fontSize: 9 },
                { text: 'C. Primavera, 1 · 28500 Arganda del Rey · Madrid', fontSize: 8 },
                { text: 'Tel. +34 918 283 898', fontSize: 8 },
              ],
            },
            {
              stack: [
                { text: 'CÁDIZ', color: '#E1062C', bold: true, fontSize: 9 },
                { text: 'C. Hungría, 11 Nave 1B · 11011 Cádiz', fontSize: 8 },
                { text: ' ', fontSize: 8 },
              ],
            },
          ],
        ],
      },
      columnGap: 18,
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 8,
        paddingRight: () => 8,
        paddingTop: () => 6,
        paddingBottom: () => 6,
        fillColor: () => '#F5F5F5',
      },
    },
    {
      text: 'www.gepservices.es',
      alignment: 'right',
      color: '#E1062C',
      bold: true,
      margin: [0, 6, 0, 0],
      fontSize: 9,
    },
  ],
})

const preventivoPdfLabels = {
  ES: {
    titulo: 'INFORME PREVENTIVO',
    fecha: 'Fecha del ejercicio',
    generales: 'Datos generales',
    registro: 'Registro',
    trabajos: 'Trabajos',
    tareas: 'Tareas',
    observaciones: 'Observaciones',
    incidencias: 'Incidencias',
    firma: 'Firma',
    anexos: 'Anexo de imágenes',
    bombero: 'Bombero/a',
    idioma: 'Idioma',
    presupuesto: 'Nº Presupuesto',
    cliente: 'Cliente',
    direccionSimulacro: 'Dirección del Preventivo',
    contacto: 'Persona de contacto',
    comercial: 'Comercial',
  },
  CA: {
    titulo: 'INFORME PREVENTIU',
    fecha: "Data de l'exercici",
    generales: 'Dades generals',
    registro: 'Registre',
    trabajos: 'Treballs',
    tareas: 'Tasques',
    observaciones: 'Observacions',
    incidencias: 'Incidències',
    firma: 'Signatura',
    anexos: "Annex d'imatges",
    bombero: 'Bomber/a',
    idioma: 'Idioma',
    presupuesto: 'Núm. de pressupost',
    cliente: 'Client',
    direccionSimulacro: 'Adreça del preventiu',
    contacto: 'Persona de contacte',
    comercial: 'Comercial',
  },
  EN: {
    titulo: 'PREVENTIVE REPORT',
    fecha: 'Exercise date',
    generales: 'General information',
    registro: 'Logbook',
    trabajos: 'Works performed',
    tareas: 'Tasks',
    observaciones: 'Observations',
    incidencias: 'Incidents',
    firma: 'Signature',
    anexos: 'Image annex',
    bombero: 'Firefighter',
    idioma: 'Language',
    presupuesto: 'Budget ID',
    cliente: 'Customer',
    direccionSimulacro: 'Preventive address',
    contacto: 'Contact person',
    comercial: 'Account manager',
  },
}

const preventivoSectionDescriptions = {
  ES: {
    trabajos: 'Resumen amplio de los trabajos solicitados y el alcance del servicio preventivo.',
    tareas: 'Detalle paso a paso de las tareas efectuadas por el equipo durante la jornada.',
    observaciones: 'Observaciones relevantes sobre seguridad, coordinación y estado de las instalaciones.',
    incidencias: 'Incidencias detectadas, medidas correctoras aplicadas y comunicación con el cliente.',
  },
  CA: {
    trabajos: 'Resum ampli dels treballs sol·licitats i l’abast del servei preventiu.',
    tareas: 'Detall pas a pas de les tasques efectuades per l’equip durant la jornada.',
    observaciones: 'Observacions rellevants sobre seguretat, coordinació i estat de les instal·lacions.',
    incidencias: 'Incidències detectades, mesures correctores aplicades i comunicació amb el client.',
  },
  EN: {
    trabajos: 'Comprehensive summary of the works requested and the scope of the preventive service.',
    tareas: 'Step-by-step detail of the tasks carried out by the crew during the shift.',
    observaciones: 'Relevant observations about safety, coordination and the condition of the facilities.',
    incidencias: 'Incidents detected, corrective measures taken and communication with the client.',
  },
}

const preventivoPdfEbroTitles = {
  ES: 'INFORME RECURSO PREVENTIVO EBRO',
  CA: 'INFORME RECURS PREVENTIU EBRO',
  EN: 'EBRO PREVENTIVE RESOURCE REPORT',
}

// ---------- docDefinition ----------
const buildDocDefinition = ({
  dealId,
  datos,
  formador,
  imagenes,
  aiContent,            // html-to-pdfmake ya convertido
  headerDataUrl,
  footerDataUrl,
}) => {
  const teorica = bullet(datos?.contenidoTeorica)
  const practica = bullet(datos?.contenidoPractica)
  const rawImagenes = Array.isArray(imagenes) ? imagenes : []
  const tipo = datos?.tipo
  const isPreventivoEbro = tipo === 'preventivo-ebro'
  const preventivoImagenesPorSeccion = isPreventivoEbro ? normalizePreventivoImagenes(datos?.preventivo?.imagenes) : null
  const preventivoHasSectionImages = isPreventivoEbro
    ? preventivoImageKeys.some((key) => (preventivoImagenesPorSeccion?.[key] || []).length > 0)
    : false
  const mergedImagenes = isPreventivoEbro ? flattenPreventivoImagenes(preventivoImagenesPorSeccion) : rawImagenes
  const imageRows = buildImageRows(mergedImagenes)
  const bomberosRaw = (formador?.nombre || '').trim()
  const bomberosList = bomberosRaw
    ? bomberosRaw.split(/\s*(?:[,;]|\r?\n)+\s*/).map((line) => line.trim()).filter(Boolean)
    : []
  const bomberosDisplay = bomberosList.length ? bomberosList : bomberosRaw ? [bomberosRaw] : ['—']
  const signatureBlock = isPreventivoEbro
    ? [
        { text: 'Atentamente:', margin: [0, 18, 0, 2] },
        ...bomberosDisplay.map((name) => ({ text: name, style: 'k' })),
        { text: 'Recurso preventivo GEP', color: '#E1062C', margin: [0, 2, 0, 0] },
      ]
    : [
        { text: 'Jaime Martret', style: 'k', margin: [0, 18, 0, 2] },
        { text: 'Director Tecnico', color: '#E1062C', margin: [0, 2, 0, 0] },
      ]

  if (datos?.tipo === 'simulacro') {
    return {
      pageSize: 'A4',
      pageMargins: [58,110,58,90],
      defaultStyle: { fontSize:10, lineHeight:1.25, font:'Poppins' },
      styles: {
        h1: { fontSize:16, bold:true, margin:[0,0,0,6] },
        h2: { fontSize:13, bold:true, margin:[0,14,0,6], color:'#E1062C' },
        h3: { fontSize:11, bold:true, margin:[0,10,0,4] },
        h4: { fontSize:10, bold:true, margin:[0,8,0,2] },
        small: { fontSize:9, color:'#666' },
        caption: { fontSize:8, color:'#666' },
        k: { bold:true },
      },
      header: () => ({ image: headerDataUrl, width:479, alignment:'center', margin:[0,18,0,0] }),
      footer: footerSimulacro,
      content: [
        { text: 'INFORME SIMULACRO', style:'h1' },
        { text: [{ text:'Fecha del simulacro: ', bold:true }, { text: datos?.fecha || '—' }], margin:[0,0,0,6] },
        {
          table: {
            widths: ['*'],
            body: [[{
              stack: [
                { text:'Datos generales', style:'h3', margin:[0,0,0,6] },
                {
                  columns: [
                    {
                      width:'50%',
                      stack: [
                        { columns: kv('Nº Presupuesto', dealId) },
                        { columns: kv('Cliente', datos?.cliente) },
                        { columns: kv('Dirección del simulacro', datos?.sede) },
                      ],
                    },
                    {
                      width:'50%',
                      stack: [
                        { columns: kv('Auditor', formador?.nombre) },
                        { columns: kv('Sesiones', String(datos?.sesiones ?? '')) },
                        { columns: kv('Duración', String(datos?.duracion ?? '')) },
                        { columns: kv('Persona de contacto', datos?.contacto) },
                        { columns: kv('Comercial', datos?.comercial) },
                      ],
                    },
                  ],
                  columnGap:20,
                },
              ],
              fillColor:'#F3F3F3',
              margin:[8,8,8,8],
            }]],
          },
          layout:{ hLineWidth:()=>0, vLineWidth:()=>0, paddingTop:()=>0, paddingBottom:()=>0, paddingLeft:()=>0, paddingRight:()=>0 },
          margin:[0,8,0,0],
        },
        { text:'DESARROLLO Y ANÁLISIS', style:'h2' },
        ...(aiContent ? [{ id:'informeTecnico', stack:Array.isArray(aiContent)?aiContent:[aiContent] }] : []),
        { text:'Evaluación Cualitativa', style:'h2', color:'#000', margin:[0,14,0,6] },
        {
          table:{
            widths:['*','*','*'],
            body:[
              [{ text:'Participación', bold:true }, { text:'Compromiso', bold:true }, { text:'Superación', bold:true }],
              [
                { text:String(datos?.escalas?.participacion ?? '—') },
                { text:String(datos?.escalas?.compromiso ?? '—') },
                { text:String(datos?.escalas?.superacion ?? '—') },
              ],
            ],
          },
          layout:'lightHorizontalLines',
          margin:[0,0,0,8],
        },
        ...signatureBlock,
        ...(mergedImagenes.length
          ? [
              { text:'Anexos — Imágenes de apoyo', style:'h2', color:'#000', margin:[0,18,0,6], pageBreak:'before' },
              ...imageRows,
            ]
          : []),
      ],
    }
  }

  if (tipo === 'preventivo' || tipo === 'preventivo-ebro') {
    const idioma = (datos?.idioma || formador?.idioma || 'ES').toUpperCase()
    const baseLabels = preventivoPdfLabels[idioma] || preventivoPdfLabels.ES
    const labels = isPreventivoEbro
      ? { ...baseLabels, titulo: preventivoPdfEbroTitles[idioma] || preventivoPdfEbroTitles.ES }
      : baseLabels
    const descriptions = preventivoSectionDescriptions[idioma] || preventivoSectionDescriptions.ES
    const leftStack = [
      !isPreventivoEbro && { columns: kv(labels.presupuesto, dealId) },
      { columns: kv(labels.cliente, datos?.cliente) },
      { columns: kv(labels.direccionSimulacro, datos?.sede) },
    ].filter(Boolean)
    const rightStack = [
      { text: labels.registro, style: 'h4', margin: [0, 0, 0, 4] },
      { columns: kv(labels.bombero, formador?.nombre) },
      { columns: kv(labels.fecha, datos?.fecha) },
      { columns: kv(labels.contacto, datos?.contacto) },
      !isPreventivoEbro && { columns: kv(labels.comercial, datos?.comercial) },
    ].filter(Boolean)
    const preventivoFields = {
      trabajos: 'c11',
      tareas: 'c12',
      observaciones: 'c13',
      incidencias: 'c14',
    }
    const preventivoSectionOrder = [
      { key: 'trabajos', label: labels.trabajos },
      { key: 'tareas', label: labels.tareas },
      { key: 'observaciones', label: labels.observaciones },
      { key: 'incidencias', label: labels.incidencias },
    ]
    const showManualPreventivoSections = !aiContent
    const preventivoBody = showManualPreventivoSections
      ? preventivoSectionOrder.flatMap(({ key, label }, index, arr) => {
          const fallbackKey = preventivoFields[key]
          const value = datos?.preventivo?.[key] ?? (fallbackKey ? datos?.comentarios?.[fallbackKey] : '')
          const paragraphs = multilineToParagraphs(value)
          const nodes = [
            { text: label, style: 'h2' },
          ]
          const description = descriptions?.[key]
          if (description) {
            nodes.push({ text: description, style: 'small', color: '#555', margin: [0, -6, 0, 6] })
          }
          nodes.push({ stack: paragraphs, margin: [0, 0, 0, index === arr.length - 1 ? 0 : 12] })
          if (isPreventivoEbro) {
            const sectionRows = buildImageRows(preventivoImagenesPorSeccion?.[key] || [])
            if (sectionRows.length) {
              nodes.push(...sectionRows)
            }
          }
          return nodes
        })
      : []
    const shouldShowAnnexImages = mergedImagenes.length > 0 && (!isPreventivoEbro || !preventivoHasSectionImages || !showManualPreventivoSections)
    return {
      pageSize: 'A4',
      pageMargins: [58,110,58,90],
      defaultStyle: { fontSize:10, lineHeight:1.25, font:'Poppins' },
      styles: {
        h1: { fontSize:16, bold:true, margin:[0,0,0,6] },
        h2: { fontSize:13, bold:true, margin:[0,14,0,6], color:'#E1062C' },
        h3: { fontSize:11, bold:true, margin:[0,10,0,4] },
        h4: { fontSize:10, bold:true, margin:[0,8,0,2] },
        small: { fontSize:9, color:'#666' },
        caption: { fontSize:8, color:'#666' },
        k: { bold:true },
      },
      header: () => ({ image: headerDataUrl, width:479, alignment:'center', margin:[0,18,0,0] }),
      footer: footerSimulacro,
      pageBreakBefore: (currentNode) => {
        if (currentNode.id === 'informeTecnico') {
          const sp = currentNode.startPosition
          if (sp && sp.pageNumber === 1) return true
        }
        return false
      },
      content: [
        { text: labels.titulo, style:'h1' },
        { text: [{ text: `${labels.fecha}: `, bold:true }, { text: datos?.fecha || '—' }], margin:[0,0,0,6] },
        {
          table: {
            widths: ['*'],
            body: [[{
              stack: [
                { text: labels.generales, style:'h3', margin:[0,0,0,6] },
                {
                  columns: [
                    {
                      width: '50%',
                      stack: leftStack,
                    },
                    {
                      width: '50%',
                      stack: rightStack,
                    },
                  ],
                  columnGap:20,
                },
              ],
              fillColor:'#F3F3F3',
              margin:[8,8,8,8],
            }]],
          },
          layout:{ hLineWidth:()=>0, vLineWidth:()=>0, paddingTop:()=>0, paddingBottom:()=>0, paddingLeft:()=>0, paddingRight:()=>0 },
          margin:[0,8,0,0],
        },
        ...preventivoBody,
        ...(aiContent ? [{ id:'informeTecnico', stack:Array.isArray(aiContent)?aiContent:[aiContent] }] : []),
        ...signatureBlock,
        ...(shouldShowAnnexImages
          ? [
              { text: labels.anexos, style:'h2', color:'#000', margin:[0,18,0,6], pageBreak:'before' },
              ...imageRows,
            ]
          : []),
      ],
    }
  }

  return {
    pageSize: 'A4',
    pageMargins: [58, 110, 58, 90], // respeta márgenes y header/footer
    defaultStyle: { fontSize: 10, lineHeight: 1.25, font: 'Poppins' }, // Poppins por defecto
    styles: {
      h1: { fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 13, bold: true, margin: [0, 14, 0, 6] },
      h3: { fontSize: 11, bold: true, margin: [0, 10, 0, 4] },
      h4: { fontSize: 10, bold: true, margin: [0, 8, 0, 2] },
      small: { fontSize: 9, color: '#666' },
      caption: { fontSize: 8, color: '#666' },
      k: { bold: true },
    },

    header: () => ({
      image: headerDataUrl,
      width: 479,
      alignment: 'center',
      margin: [0, 18, 0, 0],
    }),
    footer: () => ({
      image: footerDataUrl,
      width: 479,
      alignment: 'center',
      margin: [0, 0, 0, 18],
    }),

    // Asegurar que el bloque de Informe Técnico empieza en página 2 si iba a caer en la 1
    pageBreakBefore: (currentNode) => {
      if (currentNode.id === 'informeTecnico') {
        const sp = currentNode.startPosition
        if (sp && sp.pageNumber === 1) return true
      }
      return false
    },

    content: [
      // ===== Título + fecha
      {
        columns: [
          {
            text: [
              { text: 'INFORME FORMACIÓN: ', style: 'h1' },
              { text: datos?.formacionTitulo || '—', color: '#E1062C', bold: true, fontSize: 16 },
            ],
          },
        ],
        margin: [0, 0, 0, 4],
      },
      {
        text: [
          { text: 'Fecha de la formación: ', bold: true },
          { text: datos?.fecha || '—' },
        ],
        margin: [0, 0, 0, 6],
      },

      // ===== Bloque gris: DATOS GENERALES
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: 'Datos generales', style: 'h3', margin: [0, 0, 0, 6] },
                  {
                    columns: [
                      // IZQUIERDA (cliente)
                      {
                        width: '50%',
                        stack: [
                          { columns: kv('Nº Presupuesto', dealId) },
                          { columns: kv('Cliente', datos?.cliente) },
                          { columns: kv('Dirección de la formación', datos?.sede) },
                        ],
                      },
                      // DERECHA (formador)
                      {
                        width: '50%',
                        stack: [
                          { columns: kv('Formador', formador?.nombre) },
                          { columns: kv('Sesiones', String(datos?.sesiones ?? '')) },
                          { columns: kv('Nº de alumnos', String(datos?.alumnos ?? '')) },
                          { columns: kv('Duración', String(datos?.duracion ?? '')) }, // texto cambiado
                          { columns: kv('Persona de contacto', datos?.contacto) },   // movido aquí
                          { columns: kv('Comercial', datos?.comercial) },            // movido aquí
                        ],
                      },
                    ],
                    columnGap: 20,
                  },
                ],
                fillColor: '#F3F3F3',
                margin: [8, 8, 8, 8],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 0,
        },
        margin: [0, 8, 0, 0],
      },

      // ===== Formación realizada (sin intertítulos extra)
      { text: 'Formación realizada', style: 'h3' },
      { columns: kv('Formación', datos?.formacionTitulo) },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Teórica', style: 'k', margin: [0, 6, 0, 6] },
              ...(teorica.length ? [{ ul: teorica }] : [{ text: '—' }]),
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'Práctica', style: 'k', margin: [0, 6, 0, 6] },
              ...(practica.length ? [{ ul: practica }] : [{ text: '—' }]),
            ],
          },
        ],
        columnGap: 20,
      },

      // ===== Informe Técnico (IA) — debe iniciar en página 2 si iba a caer en la 1
      ...(aiContent
        ? [{ id: 'informeTecnico', stack: Array.isArray(aiContent) ? aiContent : [aiContent] }]
        : []),

      // ===== Evaluación Cualitativa (mantener)
      { text: 'Evaluación Cualitativa', style: 'h2' },
      {
        table: {
          widths: ['*', '*', '*'],
          body: [
            [
              { text: 'Participación', bold: true },
              { text: 'Compromiso', bold: true },
              { text: 'Superación', bold: true },
            ],
            [
              { text: String(datos?.escalas?.participacion ?? '—') },
              { text: String(datos?.escalas?.compromiso ?? '—') },
              { text: String(datos?.escalas?.superacion ?? '—') },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 8],
      },

      // ===== Firma
      ...signatureBlock,

      // ===== Anexos (imágenes)
      ...(mergedImagenes.length
        ? [{ text: 'Anexos — Imágenes de apoyo', style: 'h2', margin: [0, 18, 0, 6], pageBreak: 'before' }, ...imageRows]
        : []),
    ],
  }
}

// ---------- API usada por Preview.jsx ----------
export async function generateReportPdfmake(draft) {
  const { dealId, datos, formador, imagenes, type, aiHtml: aiHtmlOverride } = draft || {}

  const [pdfMake, htmlToPdfmake, headerDataUrl, footerDataUrl] = await Promise.all([
    ensurePdfMake(),
    ensureHtmlToPdfMake(),
    toDataURL(headerImg),
    toDataURL(footerImg),
  ])

  // Registrar Poppins (si se puede); si no, seguirá con Roboto por defecto
  await ensurePoppinsFont(pdfMake)

  let aiHtml = typeof aiHtmlOverride === 'string' ? aiHtmlOverride : ''
  if (!aiHtml) {
    try { aiHtml = sessionStorage.getItem(htmlKey(dealId)) || '' } catch { aiHtml = '' }
  }

  aiHtml = (aiHtml || '').trim()

  if (dealId && aiHtml) {
    try { sessionStorage.setItem(htmlKey(dealId), aiHtml) } catch {}
  }

  // Convertir IA HTML → estructura pdfmake
  let aiContent = null
  try {
    aiContent = htmlToPdfmake(aiHtml, {
      defaultStyles: {
        b: { bold: true },
        strong: { bold: true },
        i: { italics: true },
      },
    })
  } catch {
    const plain = stripHtml(aiHtml)
    aiContent = plain ? { text: plain } : null
  }

  const docDefinition = buildDocDefinition({
    dealId,
    datos: { ...datos, tipo: datos?.tipo || type },
    formador,
    imagenes,
    aiContent,
    headerDataUrl,
    footerDataUrl,
  })

  const fecha = (datos?.fecha || '').slice(0, 10)
  const cliente = (datos?.cliente || '').replace(/[^\w\s\-._]/g, '').trim() || 'Cliente'
  const rawTipo = datos?.tipo || type
  const baseTitulo = rawTipo === 'preventivo-ebro'
    ? 'Preventivo EBRO'
    : rawTipo === 'preventivo'
      ? 'Preventivo'
      : rawTipo === 'simulacro'
        ? 'Simulacro'
        : (datos?.formacionTitulo || 'Formación')
  const titulo = baseTitulo.replace(/[^\w\s\-._]/g, '').trim()
  const nombre = `GEP Group – ${dealId || 'SinPresu'} – ${cliente} – ${titulo} – ${fecha || 'fecha'}.pdf`

  const pdf = pdfMake.createPdf(docDefinition)

  return new Promise((resolve, reject) => {
    try {
      pdf.getBlob((blob) => {
        if (!blob) {
          reject(new Error('No se pudo generar el PDF como Blob.'))
          return
        }

        const result = { blob, fileName: nombre }
        const tasks = []

        if (typeof blob.arrayBuffer === 'function') {
          tasks.push(
            blob.arrayBuffer()
              .then((buffer) => { result.arrayBuffer = buffer })
              .catch((error) => {
                console.warn('No se pudo convertir el PDF a ArrayBuffer.', error)
              }),
          )
        }

        if (typeof pdf.getBase64 === 'function') {
          tasks.push(new Promise((res) => {
            pdf.getBase64((base64) => {
              result.base64 = base64
              result.dataUrl = `data:application/pdf;base64,${base64}`
              res()
            })
          }))
        }

        const waitFor = tasks.length ? Promise.all(tasks) : Promise.resolve()
        waitFor
          .then(() => resolve(result))
          .catch(reject)
      })
    } catch (error) {
      reject(error)
    }
  })
}