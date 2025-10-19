export const handler = async (event) => {
  try {
    const { OPENAI_API_KEY, OPENAI_BASE_URL } = process.env
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Falta OPENAI_API_KEY' }) }
    }

    const body = event.body ? JSON.parse(event.body) : {}
    const { formador, datos, previousText } = body || {}

    const datosGenerales = `
Cliente: ${datos?.cliente || ''}
Dirección de la formación: ${datos?.sede || ''}
Fecha: ${datos?.fecha || ''}
Sesiones: ${datos?.sesiones || 1}
Alumnos: ${datos?.alumnos || ''}
Duración: ${datos?.duracion || ''} h
Formador/a: ${formador?.nombre || ''}
Formación: ${datos?.formacionTitulo || '(no especificada)'}
`.trim()

    const parteTeorica = (datos?.contenidoTeorica || []).map(i=>`- ${i}`).join('\n') || '- (sin puntos)'
    const partePractica = (datos?.contenidoPractica || []).map(i=>`- ${i}`).join('\n') || '- (sin puntos)'

    const valoraciones = {
      participacion: Number(datos?.escalas?.participacion ?? 0),
      compromiso: Number(datos?.escalas?.compromiso ?? 0),
      superacion: Number(datos?.escalas?.superacion ?? 0),
    }

    const comentarios = [
      ['Puntos fuertes de los alumnos a destacar', datos?.comentarios?.c11],
      ['Incidencias: Referentes a la asistencia', datos?.comentarios?.c12],
      ['Incidencias: Referentes a la Puntualidad', datos?.comentarios?.c13],
      ['Incidencias: Accidentes', datos?.comentarios?.c14],
      ['Recomendaciones: Formaciones Futuras', datos?.comentarios?.c15],
      ['Recomendaciones: Del entorno de Trabajo', datos?.comentarios?.c16],
      ['Recomendaciones: De Materiales', datos?.comentarios?.c17],
    ].filter(([,v]) => v && String(v).trim())

    const systemPrompt = `
Eres un redactor técnico de GEP Group. Escribe en PRIMERA PERSONA plural (Nosotros), tono formal técnico PRL/PCI, preciso y claro, sin florituras. Temperatura baja.
- No muestres cifras de valoraciones. Interprétalas cualitativamente (alta/media/baja).
- No inventes datos. Usa comentarios y contexto.
- Devuelve SOLO el TEXTO de “Análisis y recomendaciones” (sin HTML).
- Extensión objetivo: 350–650 palabras.
- Idioma según se indique (ES/CA/EN).
- Si la sede del formación coincide con Calle moratin 100 de sabadell, o calle primavera 1 de arganda del rey, di que la formación se realizó en nuestra instalaciones de GEPCO Sabadell o GEPCO Madrid
`.trim()

    const userPrompt = `
### Idioma: ${datos?.idioma || 'ES'}
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
${comentarios.map(([t,v])=>`- ${t}: ${v}`).join('\n') || '- (sin comentarios)'}

${previousText ? `### Borrador anterior (mejóralo; úsalo como base si es útil)
${previousText}` : ''}

### Tarea
Redacta “Análisis y recomendaciones” en primera persona del plural (nosotros), incluyendo:
- síntesis de la formación tal como la impartimos,
- observaciones relevantes,
- incidencias detectadas (si las hubo),
- puntos de mejora,
- recomendaciones futuras (formativas, entorno, materiales) y próximos pasos sugeridos.
`.trim()

    const base = OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    })

    if (!resp.ok) {
      const errText = await resp.text()
      return { statusCode: 500, body: JSON.stringify({ error: 'OpenAI error', details: errText }) }
    }
    const data = await resp.json()
    const analysisText = (data?.choices?.[0]?.message?.content || '').trim()

    return { statusCode: 200, body: JSON.stringify({ analysisText }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'improveReport error', details: String(e) }) }
  }
}
