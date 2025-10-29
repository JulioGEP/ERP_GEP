// improveReport.ts

/* ---------------- Tipos mínimos (sin depender de Netlify) ---------------- */
type HandlerEvent = { httpMethod?: string; body?: string | null };
type HandlerResponse = { statusCode: number; headers?: Record<string, string>; body: string };

type Idioma3 = 'ES' | 'CA' | 'EN';

interface Formador {
  nombre?: string;
  idioma?: string;
}

interface Escalas {
  participacion?: number | string;
  compromiso?: number | string;
  superacion?: number | string;
}

interface Comentarios {
  c11?: string;
  c12?: string;
  c13?: string;
  c14?: string;
  c15?: string;
  c16?: string;
  c17?: string;
}

interface Datos {
  cliente?: string;
  sede?: string;
  fecha?: string;
  sesiones?: number | string;
  alumnos?: number | string;
  duracion?: number | string;
  formacionTitulo?: string;
  contenidoTeorica?: string[];
  contenidoPractica?: string[];
  escalas?: Escalas;
  comentarios?: Comentarios;
  idioma?: string;
}

interface RequestBody {
  formador?: Formador;
  datos?: Datos;
  previousText?: string;
}

/* ---------------- Respuesta OpenAI ---------------- */
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChoice {
  index: number;
  message: OpenAIChatMessage;
  finish_reason?: string;
}

interface OpenAIChatResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAIChoice[];
}

/* ---------------- Helper: normalizar base URL ---------------- */
const resolveOpenAIBase = (baseUrl?: string): string => {
  const raw = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  return raw.replace(/\/+$/, '');
};

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;

    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falta OPENAI_API_KEY' }) };
    }

    const body: RequestBody = event.body ? JSON.parse(event.body) : {};
    const { formador = {}, datos = {}, previousText } = body;

    const datosGenerales = `
Cliente: ${datos?.cliente || ''}
Dirección de la formación: ${datos?.sede || ''}
Fecha: ${datos?.fecha || ''}
Sesiones: ${datos?.sesiones || 1}
Alumnos: ${datos?.alumnos || ''}
Duración: ${datos?.duracion || ''} h
Formador/a: ${formador?.nombre || ''}
Formación: ${datos?.formacionTitulo || '(no especificada)'}
`.trim();

    const parteTeorica =
      (datos?.contenidoTeorica || []).map((i: string) => `- ${i}`).join('\n') || '- (sin puntos)';

    const partePractica =
      (datos?.contenidoPractica || []).map((i: string) => `- ${i}`).join('\n') || '- (sin puntos)';

    const valoraciones = {
      participacion: Number(datos?.escalas?.participacion ?? 0),
      compromiso: Number(datos?.escalas?.compromiso ?? 0),
      superacion: Number(datos?.escalas?.superacion ?? 0),
    };

    const comentariosPairs: Array<[string, string | undefined]> = [
      ['Puntos fuertes de los alumnos a destacar', datos?.comentarios?.c11],
      ['Incidencias: Referentes a la asistencia', datos?.comentarios?.c12],
      ['Incidencias: Referentes a la Puntualidad', datos?.comentarios?.c13],
      ['Incidencias: Accidentes', datos?.comentarios?.c14],
      ['Recomendaciones: Formaciones Futuras', datos?.comentarios?.c15],
      ['Recomendaciones: Del entorno de Trabajo', datos?.comentarios?.c16],
      ['Recomendaciones: De Materiales', datos?.comentarios?.c17],
    ];

    const comentarios = comentariosPairs
      .filter(([, v]) => !!(v && String(v).trim()))
      .map(([t, v]) => `- ${t}: ${v}`)
      .join('\n') || '- (sin comentarios)';

    const idioma: Idioma3 = ((datos?.idioma || formador?.idioma || 'ES').toUpperCase() as Idioma3);

    const systemPrompt = `
Eres un redactor técnico de GEP Group. Escribe en PRIMERA PERSONA plural (Nosotros), tono formal técnico PRL/PCI, preciso y claro, sin florituras. Temperatura baja.
- No muestres cifras de valoraciones. Interprétalas cualitativamente (alta/media/baja).
- No inventes datos. Usa comentarios y contexto.
- Devuelve SOLO el TEXTO de “Análisis y recomendaciones” (sin HTML).
- Extensión objetivo: 350–650 palabras.
- Idioma según se indique (ES/CA/EN).
- Si la sede del formación coincide con Calle moratin 100 de sabadell, o calle primavera 1 de arganda del rey, di que la formación se realizó en nuestra instalaciones de GEPCO Sabadell o GEPCO Madrid
`.trim();

    const userPrompt = `
### Idioma: ${idioma}
### Formador: ${formador?.nombre || ''}

### Datos generales (contexto, NO reescribir, NO devolver)
${datosGenerales}

### Contenido de la formación (contexto, NO reescribir, NO devolver)
[Parte Teórica]
${parteTeorica}
[Parte Práctica]
${partePractica}

### Valoraciones (contexto; NO devolver números)
- Participación: ${valoraciones.participacion}
- Compromiso: ${valoraciones.compromiso}
- Superación: ${valoraciones.superacion}

### Comentarios del formador (contexto)
${comentarios}

${previousText ? `### Borrador anterior (mejóralo; úsalo como base si es útil)
${previousText}` : ''}

### Tarea
Redacta “Análisis y recomendaciones” en primera persona del plural (nosotros), incluyendo:
- síntesis de la formación tal como la impartimos,
- observaciones relevantes,
- incidencias detectadas (si las hubo),
- puntos de mejora,
- recomendaciones futuras (formativas, entorno, materiales) y próximos pasos sugeridos.
`.trim();

    const base = resolveOpenAIBase(OPENAI_BASE_URL);
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ] as OpenAIChatMessage[],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 500, body: JSON.stringify({ error: 'OpenAI error', details: errText }) };
    }

    const data = (await resp.json()) as OpenAIChatResponse;
    const analysisText = (data.choices?.[0]?.message?.content || '').trim();

    return { statusCode: 200, body: JSON.stringify({ analysisText }) };
  } catch (e: unknown) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'improveReport error', details: String(e) }),
    };
  }
};
