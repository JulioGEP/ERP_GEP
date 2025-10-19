const ALLOWED_ORIGIN = process.env.REPORTS_ALLOWED_ORIGIN || 'https://www.gepservices.es';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Expose-Headers': 'content-type',
};

const MODEL = 'gpt-4o-mini';

const sanitizeContent = (content = '') =>
  (content || '')
    .replace(/^\s*```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

const compactText = (value) => {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(/\s+/g, ' ').trim();
};

const pickLabel = (idioma, es, ca, en) => {
  if ((idioma || '').toUpperCase() === 'CA') return ca;
  if ((idioma || '').toUpperCase() === 'EN') return en;
  return es;
};

const ensureSection = (html, title) => {
  const trimmed = sanitizeContent(html);
  if (!trimmed) return '';
  if (/<section[\s>]/i.test(trimmed)) return trimmed;
  const safe = compactText(trimmed);
  if (!safe) return '';
  return `<section><h3>${title}</h3><p>${safe}</p></section>`;
};

const resolveOpenAIBase = (baseUrl) => {
  const raw = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  return raw.replace(/\/+$/, '');
};

const callChatCompletion = async ({ apiKey, baseUrl, temperature, messages }) => {
  const url = `${resolveOpenAIBase(baseUrl)}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      messages,
    }),
  });

  const raw = await resp.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      console.error('[callChatCompletion] JSON parse error:', error, raw);
      if (!resp.ok) throw new Error(raw || 'OpenAI error');
      throw new Error('Invalid JSON response from OpenAI');
    }
  }

  if (!resp.ok) {
    const message = data?.error?.message || raw || 'OpenAI error';
    throw new Error(message);
  }

  return sanitizeContent(data?.choices?.[0]?.message?.content || '');
};

const buildSimulacroSystem = (idioma) => {
  const lang = (idioma || 'ES').toUpperCase();
  if (lang === 'EN') {
    return 'You are a technical writer for GEP Group, expert in emergency drills. Reply in first person plural (we) with a formal PRL/PCI emergency tone. Respond only with HTML using <section>, <h3>, <h4>, <p>, <ul>, <li>. Never show numeric scores and never invent data.';
  }
  if (lang === 'CA') {
    return 'Ets un redactor tècnic de GEP Group, expert en auditar simulacres. Respon sempre en primera persona del plural (nosaltres) amb to formal tècnic PRL/PCI i emergències. Respon únicament amb HTML utilitzant <section>, <h3>, <h4>, <p>, <ul>, <li>. No mostris puntuacions numèriques ni inventis dades.';
  }
  return 'Eres un redactor técnico de GEP Group, experto en auditar simulacros. Responde siempre en primera persona plural (nosotros) con tono formal técnico PRL/PCI y emergencias. Devuelve únicamente HTML usando <section>, <h3>, <h4>, <p>, <ul>, <li>. No muestres puntuaciones numéricas ni inventes datos.';
};

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
};

const buildPreventivoSystem = (idioma) => {
  const lang = (idioma || 'ES').toUpperCase();
  if (lang === 'EN') {
    return [
      'You are a technical writer for GEP Group, specialised in preventive emergency drills.',
      'Always write in first-person plural (we) with a formal PRL/PCI emergency tone: precise, direct and without embellishment.',
      'Do not invent information. Correct grammar and spelling. Output plain text only, no HTML.',
      'Use exactly the headings provided, one per line, and keep the sections “Works performed”, “Tasks”, “Observations” and “Incidents” between 350 and 450 words each.',
      'Close with a signature block that starts with “Regards:” followed by the provided firefighter name(s) and finish with “Recurso preventivo GEP”. Mention the image annex after the signature.',
    ].join('\n');
  }
  if (lang === 'CA') {
    return [
      'Ets un redactor tècnic de GEP Group especialitzat en exercicis preventius.',
      'Escriu sempre en primera persona del plural (nosaltres) amb to formal tècnic PRL/PCI: precís, directe i sense floritures.',
      'No inventis dades. Corregeix ortografia i gramàtica. Respon només amb text pla, sense HTML.',
      'Fes servir exactament els encapçalaments indicats, un per línia, i mantén les seccions “Treballs”, “Tasques”, “Observacions” i “Incidències” entre 350 i 450 paraules cadascuna.',
      'Tanca amb una signatura que comenci per “Atentament:” seguida dels noms del bomber o bombers indicats i finalitzi amb “Recurso preventivo GEP”. Cita l’annex d’imatges després de la signatura.',
    ].join('\n');
  }
  return [
    'Eres un redactor técnico de GEP Group especializado en ejercicios preventivos.',
    'Escribe siempre en primera persona del plural (nosotros) con un tono formal técnico PRL/PCI: preciso, directo y sin florituras.',
    'No inventes datos. Corrige ortografía y gramática. Devuelve únicamente texto plano, sin HTML.',
    'Utiliza exactamente los encabezados indicados, uno por línea, y mantén las secciones “Trabajos”, “Tareas”, “Observaciones” e “Incidencias” entre 350 y 450 palabras cada una.',
    'Cierra con una firma que empiece por “Atentamente:” y continúe con los nombres del bombero o bomberos facilitados para terminar con “Recurso preventivo GEP”. Menciona el anexo de imágenes después de la firma.',
  ].join('\n');
};

async function generarHtmlSimulacro({ apiKey, baseUrl, idioma, datos, formador }) {
  const lang = (idioma || 'ES').toUpperCase();
  const safe = (value) => {
    const text = compactText(value);
    return text === '' ? '-' : text;
  };

  const cronologiaArray = Array.isArray(datos?.cronologia) ? datos.cronologia : [];
  const cronologiaJson = JSON.stringify(cronologiaArray, null, 2);
  const cronologiaListado = cronologiaArray
    .map((c, idx) => {
      const hora = safe(c?.hora);
      const texto = safe(c?.texto);
      return `${idx + 1}. ${hora} — ${texto}`;
    })
    .join('\n');

  const ctx = [
    `Cliente: ${safe(datos?.cliente)}`,
    `CIF: ${safe(datos?.cif)} | Dirección: ${safe(datos?.sede)}`,
    `Auditor: ${safe(formador?.nombre)} | Idioma: ${lang}`,
    `Sesiones: ${safe(datos?.sesiones)} | Duración(h): ${safe(datos?.duracion)}`,
    '',
    'Desarrollo propuesto:',
    safe(datos?.desarrollo),
    '',
    'Cronología declarada:',
    cronologiaListado ? `- ${cronologiaListado.split('\n').join('\n- ')}` : '- Sin cronología registrada',
    '',
    `Valoraciones (1-10): Participación=${datos?.escalas?.participacion ?? 0}, Compromiso=${datos?.escalas?.compromiso ?? 0}, Superación=${datos?.escalas?.superacion ?? 0}`,
    '',
    `Incidencias detectadas: ${safe(datos?.comentarios?.c12)}`,
    `Accidentes: ${safe(datos?.comentarios?.c14)}`,
    `Recomendaciones formaciones: ${safe(datos?.comentarios?.c15)}`,
    `Recomendaciones entorno: ${safe(datos?.comentarios?.c16)}`,
    `Recomendaciones materiales: ${safe(datos?.comentarios?.c17)}`,
    `Observaciones generales: ${safe(datos?.comentarios?.c11)}`,
  ]
    .join('\n')
    .trim();

  const system = buildSimulacroSystem(idioma);

  const participacion = datos?.escalas?.participacion ?? '';
  const compromiso = datos?.escalas?.compromiso ?? '';
  const superacion = datos?.escalas?.superacion ?? '';

  const incidenciasTexto = safe(datos?.comentarios?.c12);
  const accidentesTexto = safe(datos?.comentarios?.c14);
  const observacionesTexto = safe(datos?.comentarios?.c11);
  const recForm = safe(datos?.comentarios?.c15);
  const recEntorno = safe(datos?.comentarios?.c16);
  const recMateriales = safe(datos?.comentarios?.c17);
  const desarrolloOriginal = safe(datos?.desarrollo);

  const desarrolloTitle = pickLabel(idioma, 'DESARROLLO', 'DESENVOLUPAMENT', 'DEVELOPMENT');
  const cronologiaTitle = pickLabel(idioma, 'CRONOLOGÍA', 'CRONOLOGIA', 'TIMELINE');
  const contingenciasTitle = pickLabel(idioma, 'Gestión de contingencias', 'Gestió de contingències', 'Contingency management');
  const mejoraTitle = pickLabel(idioma, 'Líneas de mejora prioritarias', 'Línies de millora prioritàries', 'Priority improvement actions');
  const cierreTitle = pickLabel(idioma, 'Cierre de la auditoría', "Tancament de l'auditoria", 'Audit closing remarks');

  const sections = [
    {
      title: desarrolloTitle,
      temperature: 0.4,
      instructions: [
        `Genera la sección HTML "${desarrolloTitle}" del informe del simulacro.`,
        '- El primer elemento debe ser un <h3> con el título exacto.',
        `- Contenido original del campo "Desarrollo": "${desarrolloOriginal}". Resúmelo y amplíalo sin copiar literalmente.`,
        '- Describe el escenario, el problema simulado y la respuesta que debíamos ensayar.',
        '- Añade detalles sobre los riesgos principales y qué podía salir mal si no se seguían los procedimientos.',
        '- Integra sólo cuando aporte valor las incidencias y accidentes registrados, evitando copiar el texto original.',
        '- Redacta en primera persona plural y no inventes datos nuevos.',
      ].join('\n'),
    },
    {
      title: cronologiaTitle,
      temperature: 0.4,
      instructions: [
        `Genera la sección HTML "${cronologiaTitle}" del informe del simulacro.`,
        '- El primer elemento debe ser un <h3> con el título exacto.',
        '- Recuerda que la cronología detallada ya figura en el documento antes de este bloque.',
        '- Redacta únicamente un resumen crítico en uno o dos párrafos que destaque hitos, tiempos de respuesta y riesgos detectados.',
        '- No enumeres de nuevo cada evento ni crees listas; céntrate en conclusiones e insights.',
        '- Si no hay cronología, explica por qué no se registraron eventos y cómo afecta al análisis.',
        `Cronología original (JSON):\n${cronologiaJson}`,
      ].join('\n'),
    },
    {
      title: contingenciasTitle,
      temperature: 0.6,
      instructions: [
        `Genera la sección HTML "${contingenciasTitle}".`,
        '- El primer elemento debe ser un <h3> con el título exacto.',
        `- Analiza cómo se gestionaron incidencias y accidentes: incidencias="${incidenciasTexto}", accidentes="${accidentesTexto}".`,
        '- Relaciona cada situación con la cronología y el impacto en la seguridad, señalando controles aplicados y riesgos mitigados.',
        '- Usa párrafos o una lista corta (<ul>/<li>) solo si ayuda a ordenar varios focos críticos.',
        '- Si no hubo incidencias relevantes, explica qué controles preventivos funcionaron y qué indicadores lo demuestran.',
      ].join('\n'),
    },
    {
      title: mejoraTitle,
      temperature: 0.7,
      instructions: [
        `Genera la sección HTML "${mejoraTitle}".`,
        '- El primer elemento debe ser un <h3> con el título exacto.',
        `- Fundamenta cada línea de mejora a partir de las propuestas registradas: formaciones="${recForm}", entorno="${recEntorno}", materiales="${recMateriales}".`,
        '- Reformula y sintetiza estas ideas sin copiar literalmente los textos originales.',
        '- Explica qué riesgo o brecha cubre cada acción y qué prioridad debería tener.',
        '- Añade, si procede, observaciones profesionales que refuercen la necesidad de implantarlas.',
      ].join('\n'),
    },
    {
      title: cierreTitle,
      temperature: 0.5,
      instructions: [
        `Genera la sección HTML "${cierreTitle}".`,
        '- El primer elemento debe ser un <h3> con el título exacto.',
        `- Sintetiza la evaluación cualitativa interpretando las valoraciones: participación=${participacion}, compromiso=${compromiso}, superación=${superacion} (sin mencionar números).`,
        `- Integra las observaciones generales registradas ("${observacionesTexto}") para reforzar la conclusión.`,
        '- Cierra con una valoración global del simulacro y los próximos pasos inmediatos desde la perspectiva del auditor.',
      ].join('\n'),
    },
  ];

  const htmlSections = await Promise.all(
    sections.map(async (section) => {
      const prompt = `${section.instructions}\n\nContexto del simulacro:\n${ctx}`;
      const content = await callChatCompletion({
        apiKey,
        baseUrl,
        temperature: section.temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      });
      return ensureSection(content, section.title);
    })
  );

  return htmlSections.filter(Boolean).join('\n');
}

async function generarInformePreventivo({ apiKey, baseUrl, idioma, datos, formador }) {
  const lang = (idioma || 'ES').toUpperCase();
  const headings = preventivoHeadings[lang] || preventivoHeadings.ES;
  const system = buildPreventivoSystem(lang);

  const safe = (value) => {
    if (value === null || value === undefined) return '-';
    const text = typeof value === 'string' ? value : String(value);
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact || '-';
  };

  const bloque = (titulo, contenido) => `${titulo} (original):\n${(contenido || '').trim() || '-'}`;

  const prev = datos?.preventivo || {};

  const contexto = [
    `Cliente: ${safe(datos?.cliente)} | CIF: ${safe(datos?.cif)}`,
    `Dirección fiscal: ${safe(datos?.direccionOrg)}`,
    `Dirección del Preventivo: ${safe(datos?.sede)}`,
    `Persona de contacto: ${safe(datos?.contacto)} | Comercial: ${safe(datos?.comercial)}`,
    `Bombero/a responsable: ${safe(formador?.nombre)} | Idioma solicitado: ${lang}`,
    `Fecha del ejercicio: ${safe(datos?.fecha)}`,
    '',
    bloque(headings.trabajos, prev.trabajos),
    '',
    bloque(headings.tareas, prev.tareas),
    '',
    bloque(headings.observaciones, prev.observaciones),
    '',
    bloque(headings.incidencias, prev.incidencias),
  ].join('\n');

  const prompt = `
Encabezados obligatorios en este orden (una línea por encabezado, sin numeración, y sin añadir otros títulos):
${headings.registro}
${headings.trabajos}
${headings.tareas}
${headings.observaciones}
${headings.incidencias}
${headings.firma}
${headings.anexos}

Indicaciones:
- No incluyas la sección "${headings.generales}" ni ningún otro bloque equivalente; esa información ya aparece al inicio del informe.
- En "${headings.registro}" contextualiza el servicio prestado por nuestro equipo, la fecha de realización y, si procede, sintetiza en una frase los datos generales sin repetirlos literalmente.
- Reescribe "${headings.trabajos}", "${headings.tareas}", "${headings.observaciones}" e "${headings.incidencias}" con una extensión de entre 350 y 450 palabras cada sección, interpretando profesionalmente el material original.
- Si falta información relevante en alguna sección, explica cómo afecta al análisis sin inventar datos.
- En "${headings.firma}" incluye una firma que comience con "Atentamente:" seguida de los nombres del bombero o bomberos facilitados y termine con "Recurso preventivo GEP".
- En "${headings.anexos}" indica que las imágenes quedan adjuntas como anexo posterior a la firma.

Contexto disponible:
${contexto}
`.trim();

  return callChatCompletion({
    apiKey,
    baseUrl,
    temperature: 0.5,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  });
}

// ───────── Utils mínimas (solo lo necesario) ─────────
const normalize = (s = '') =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const formatFechaDDMMYYYY = (iso) => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
};

const esInstalacionGEPCO = (direccion = '') => {
  const n = normalize(direccion);
  const a = n.includes('primavera, 1') && n.includes('arganda del rey') && n.includes('madrid');
  const b = n.includes('moratin, 100') && n.includes('sabadell') && n.includes('barcelona');
  return a || b;
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const API_KEY = process.env.OPENAI_API_KEY;
    const BASE_URL = process.env.OPENAI_BASE_URL;
    if (!API_KEY) throw new Error('Missing OPENAI_API_KEY');

    const { formador, datos, previousHtml } = JSON.parse(event.body || '{}');
    const idioma = (formador?.idioma || 'ES').toUpperCase();
    const tipo = datos?.tipo || 'formacion';

    const fechaFmt = formatFechaDDMMYYYY(datos?.fecha || '');
    const sede = datos?.sede || '-';
    const sedeEsGEPCO = esInstalacionGEPCO(sede);

    if (tipo === 'simulacro') {
      const html = await generarHtmlSimulacro({ apiKey: API_KEY, baseUrl: BASE_URL, idioma, datos, formador });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
        body: JSON.stringify({ html }),
      };
    }

    if (tipo === 'preventivo' || tipo === 'preventivo-ebro') {
      const texto = await generarInformePreventivo({ apiKey: API_KEY, baseUrl: BASE_URL, idioma, datos, formador });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
        body: JSON.stringify({ html: texto }),
      };
    }

    const ctx = `
Deal: ${datos?.cliente || '-'} | CIF: ${datos?.cif || '-'}
Sede: ${datos?.sede || '-'} | Fecha: ${datos?.fecha || '-'}
Formador/a: ${formador?.nombre || '-'} | Idioma: ${idioma}
Sesiones: ${datos?.sesiones || '-'} | Alumnos: ${datos?.alumnos || '-'} | Duración(h): ${datos?.duracion || '-'}

Formación: ${datos?.formacionTitulo || '-'}

Parte teórica:
- ${(datos?.contenidoTeorica || []).join('\n- ')}

Parte práctica:
- ${(datos?.contenidoPractica || []).join('\n- ')}

Valoraciones (1-10) — usar solo cualitativos:
Participación=${datos?.escalas?.participacion ?? 0}, Compromiso=${datos?.escalas?.compromiso ?? 0}, Superación=${datos?.escalas?.superacion ?? 0}

Comentarios:
- Puntos fuertes: ${datos?.comentarios?.c11 || '-'}
- Asistencia: ${datos?.comentarios?.c12 || '-'}
- Puntualidad: ${datos?.comentarios?.c13 || '-'}
- Accidentes: ${datos?.comentarios?.c14 || '-'}
- Formaciones futuras: ${datos?.comentarios?.c15 || '-'}
- Entorno de trabajo: ${datos?.comentarios?.c16 || '-'}
- Materiales: ${datos?.comentarios?.c17 || '-'}
`.trim();

    const system = (idioma === 'EN')
      ? 'You are a technical writer. Write in first person as the trainer, formal and precise. Temperature 0.3. Never show numeric scores.'
      : (idioma === 'CA')
        ? 'Ets un redactor tècnic. Escriu en primera persona com a formador, to formal i precís. Temperatura 0.3. No mostris puntuacions numèriques.'
        : 'Eres un redactor técnico. Escribe en primera persona como el formador, tono formal y preciso. Temperatura 0.3. No muestres puntuaciones numéricas.';

    const borradorPrevio = typeof previousHtml === 'string' ? sanitizeContent(previousHtml) : '';

    const prompt = `
Redacta un INFORME TÉCNICO en primera persona (yo) basado en el contexto.
No muestres números de las escalas; interpreta en texto (“participación alta/media/baja”, etc.).

Estructura:
- Introducción breve (qué formación impartí, para quién y cuándo).
- Desarrollo (cómo transcurrió, puntos teóricos y prácticos relevantes).
- Incidencias (asistencia, puntualidad, accidentes si los hubo).
- Evaluación cualitativa (participación, compromiso, superación) sin números.
- Recomendaciones (mejoras del entorno, materiales y/o formaciones futuras).

IMPORTANTE:
- Devuelve **solo** un fragmento HTML **puro** (sin \`\`\`, ni etiquetas <html>/<body>, ni estilos inline).
- Usa únicamente <section>, <h3>, <p>, <ul>, <li>. Nada más.
- La fecha debe aparecer en formato DD/MM/YYYY exactamente así: "${fechaFmt || 'DD/MM/YYYY'}".
- Si la sede de la formación corresponde a:
  • C/ Primavera, 1, 28500, Arganda del Rey, Madrid
  • Carrer de Moratín, 100, 08206 Sabadell, Barcelona
  entonces son **nuestras instalaciones** (GEPCO).Sino, di que "en sus instalaciones"

Contexto:
${ctx}
${borradorPrevio ? `

Borrador actual (mejóralo o reescríbelo manteniendo las instrucciones anteriores, corrigiendo errores y evitando repeticiones):
${borradorPrevio}` : ''}
`.trim();

    const html = await callChatCompletion({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({ html }),
    };
  } catch (err) {
    console.error('[generateReport] error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
