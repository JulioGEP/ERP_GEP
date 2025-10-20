// backend/functions/_shared/dealPayload.ts

/** Limpia HTML simple de notas/contenidos, preservando saltos y viñetas básicas */
export function sanitizeHtml(html: unknown): string | null {
  if (html === null || html === undefined) return null;
  const text = String(html)
    .replace(/\r\n/g, '\n')                    // normaliza CRLF
    .replace(/<br\s*\/?>/gi, '\n')            // <br> → salto de línea
    .replace(/<\/p>/gi, '\n')                 // </p> → salto de línea
    .replace(/<li[^>]*>/gi, '• ')             // <li> → viñeta
    .replace(/<\/li>/gi, '\n')                // </li> → salto de línea
    .replace(/<\/ul>|<\/ol>/gi, '\n')         // cierre de listas → salto
    .replace(/<[^>]+>/g, ' ')                 // resto de tags fuera
    .replace(/&nbsp;/gi, ' ')                 // entidades comunes
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')               // espacios antes de \n
    .replace(/\n{3,}/g, '\n\n')               // colapsa múltiples \n
    .replace(/[ \t]{2,}/g, ' ')               // colapsa espacios
    .trim();
  return text || null;
}

/** Asegura siempre un array (si no, array vacío) */
export function normalizeJsonArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Convierte a string o null, limpiando espacios */
function toNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Convierte a número entero >= 0 o null */
function toNonNegativeIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * Construye un payload normalizado de Deal a partir de un "record" heterogéneo.
 * Soporta alias usados en el proyecto (trainingAddress/training_address, *_label, etc.).
 * Nota: exponemos tanto `training_address_label` como `training_address` para compatibilidad.
 */
export function buildDealPayloadFromRecord(record: any) {
  if (!record) return null;

  const training = normalizeJsonArray(record.training);
  const prodExtra = normalizeJsonArray(record.prodextra ?? record.prodExtra);
  const documents = normalizeJsonArray<any>(record.documents);
  const notes = normalizeJsonArray<any>(record.notes);
  const participants = normalizeJsonArray<any>(record.participants);

  const trainingNames = training
    .map((p: any) => (p && typeof p.name === 'string' ? p.name : null))
    .filter(Boolean) as string[];

  const extraNames = prodExtra
    .map((p: any) => (p && typeof p.name === 'string' ? p.name : null))
    .filter(Boolean) as string[];

  // Horas: permitimos string/number, devolvemos string tal como espera el front cuando viene de DB
  const hours =
    (typeof record.hours === 'string' && record.hours.trim().length ? record.hours.trim() : null) ??
    (toNonNegativeIntOrNull(record.hours) != null ? String(toNonNegativeIntOrNull(record.hours)) : null);

  const orgId =
    toNullableString(record.organizationId) ??
    toNullableString(record.org_id) ??
    (record.organization?.org_id ? toNullableString(record.organization.org_id) : null);

  const organization = record.organization ?? null;

  // Dirección de formación: resolvemos ambas variantes y exponemos las dos
  const trainingAddressLabel =
    toNullableString(record.training_address_label) ??
    toNullableString(record.trainingAddressLabel);

  const trainingAddressFallback =
    toNullableString(record.training_address) ??
    toNullableString(record.trainingAddress);

  // Elegimos label si existe; si no, el fallback “address”
  const trainingAddressPreferred = trainingAddressLabel ?? trainingAddressFallback;

  return {
    deal_id: record.id ?? record.deal_id ?? null,

    // Organización
    org_id: orgId,
    organization_name:
      toNullableString(organization?.name) ??
      toNullableString(record.organization_name) ??
      'Organización sin nombre',
    organization_cif:
      toNullableString(organization?.cif ?? organization?.CIF) ??
      toNullableString(record.organization_cif),
    organization_phone:
      toNullableString(organization?.phone) ??
      toNullableString(record.organization_phone),
    organization_address:
      toNullableString(organization?.address) ??
      toNullableString(record.organization_address),

    // Metadatos del deal
    title: toNullableString(record.title),
    pipeline_id: toNullableString(record.trainingType) ?? toNullableString(record.pipeline_id),

    // Formación y extras
    training,
    training_names: trainingNames,
    hours, // string|null

    // Dirección — exponemos ambas claves para compatibilidad con front/backend
    training_address_label: trainingAddressPreferred,
    training_address: trainingAddressFallback ?? trainingAddressPreferred,

    sede_label: toNullableString(record.sede_label) ?? toNullableString(record.sedeLabel),
    caes_label: toNullableString(record.caes_label) ?? toNullableString(record.caesLabel),
    fundae_label: toNullableString(record.fundae_label) ?? toNullableString(record.fundaeLabel),
    hotel_label: toNullableString(record.hotel_label) ?? toNullableString(record.hotelLabel),

    prodextra: prodExtra,
    prodextra_names: extraNames,

    // Documentos (mantenemos arrays auxiliares para compatibilidad)
    documents_num: toNonNegativeIntOrNull(record.documentsNum) ?? documents.length,
    documents_id: documents.map((d: any) => d?.id ?? null).filter(Boolean),
    documents: documents.map(
      (d: any, i: number) =>
        toNullableString(d?.title) ??
        toNullableString(d?.url) ??
        `Documento ${d?.id ?? i + 1}`
    ),
    documents_urls: documents.map((d: any) => toNullableString(d?.url)),

    // Notas
    notes_count: toNonNegativeIntOrNull(record.notesNum) ?? notes.length,
    notes: notes.map((n: any) => sanitizeHtml(n?.comment) ?? toNullableString(n?.comment) ?? ''),

    // Fechas
    created_at: record.createdAt?.toISOString?.() ?? record.createdAt ?? null,
    updated_at: record.updatedAt?.toISOString?.() ?? record.updatedAt ?? null,

    // Participantes / personas vinculadas
    persons: participants.map((p: any) => ({
      person_id: toNullableString(p?.personId ?? p?.person_id),
      role: toNullableString(p?.role),
      first_name: toNullableString(p?.person?.firstName ?? p?.first_name),
      last_name: toNullableString(p?.person?.lastName ?? p?.last_name),
      email: toNullableString(p?.person?.email ?? p?.email),
      phone: toNullableString(p?.person?.phone ?? p?.phone),
    })),
  };
}
