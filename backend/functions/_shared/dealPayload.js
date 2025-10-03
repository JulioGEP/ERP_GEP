function sanitizeHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function normalizeJsonArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [];
}

function buildDealPayloadFromRecord(record) {
  if (!record) return null;

  const training = normalizeJsonArray(record.training);
  const prodExtra = normalizeJsonArray(record.prodextra ?? record.prodExtra);
  const documents = Array.isArray(record.documents) ? record.documents : [];
  const notes = Array.isArray(record.notes) ? record.notes : [];
  const participants = Array.isArray(record.participants) ? record.participants : [];

  const trainingNames = training
    .map((product) => (product && typeof product.name === 'string' ? product.name : null))
    .filter(Boolean);
  const extraNames = prodExtra
    .map((product) => (product && typeof product.name === 'string' ? product.name : null))
    .filter(Boolean);

  return {
    deal_id: record.id,
    org_id: record.organizationId ?? record.org_id ?? null,
    organization_name: record.organization?.name ?? record.organization_name ?? 'Organización sin nombre',
    organization_cif: record.organization?.cif ?? record.organization_cif ?? null,
    organization_phone: record.organization?.phone ?? record.organization_phone ?? null,
    organization_address: record.organization?.address ?? record.organization_address ?? null,
    title: record.title,
    pipeline_id: record.trainingType ?? record.pipeline_id ?? null,
    training,
    training_names: trainingNames,
    hours: record.hours,
    training_address: record.training_address ?? record.trainingAddress ?? null,
    sede_label: record.sede_label ?? record.sedeLabel ?? null,
    caes_label: record.caes_label ?? record.caesLabel ?? null,
    fundae_label: record.fundae_label ?? record.fundaeLabel ?? null,
    hotel_label: record.hotel_label ?? record.hotelLabel ?? null,
    prodextra: prodExtra,
    prodextra_names: extraNames,
    documents_num: record.documentsNum ?? documents.length,
    documents_id: documents.map((doc) => doc.id),
    documents: documents.map((doc) => doc.title ?? doc.url ?? `Documento ${doc.id}`),
    documents_urls: documents.map((doc) => doc.url ?? null),
    notes_count: record.notesNum ?? notes.length,
    notes: notes.map((note) => sanitizeHtml(note.comment) ?? note.comment ?? ''),
    created_at: record.createdAt?.toISOString?.() ?? record.createdAt,
    updated_at: record.updatedAt?.toISOString?.() ?? record.updatedAt,
    persons: participants.map((participant) => ({
      person_id: participant.personId ?? participant.person_id ?? null,
      role: participant.role ?? null,
      first_name: participant.person?.firstName ?? participant.first_name ?? null,
      last_name: participant.person?.lastName ?? participant.last_name ?? null,
      email: participant.person?.email ?? participant.email ?? null,
      phone: participant.person?.phone ?? participant.phone ?? null
    }))
  };
}

module.exports = {
  sanitizeHtml,
  normalizeJsonArray,
  buildDealPayloadFromRecord
};
