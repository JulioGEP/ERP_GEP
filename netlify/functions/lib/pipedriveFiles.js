// netlify/functions/lib/pipedriveFiles.js
// Modo "smart": usa /deals/{id}/files y, si viene vacío, cae a /files?deal_id= con filtros fuertes.

const fetch = global.fetch || require('node-fetch');

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword', // doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel', // xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-powerpoint', // ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'text/csv',
]);

const ALLOWED_EXT = new Set([
  'pdf', 'png', 'jpg', 'jpeg',
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
  'csv',
]);

function extFromName(name) {
  if (!name) return '';
  const clean = String(name).split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('.');
  if (i === -1) return '';
  return clean.slice(i + 1).toLowerCase();
}

function isAllowedByMimeOrExt(file_type, file_name) {
  const ft = (file_type || '').toLowerCase();
  const ext = extFromName(file_name);
  if (ALLOWED_MIME.has(ft)) return true;
  if (ALLOWED_EXT.has(ext)) return true;
  return false;
}

function normalizeName(name) {
  if (!name) return null;
  const s = String(name);
  return s.includes('?') ? s.split('?')[0] : s;
}

function inDateWindow(add_time, refDate, days = 365) {
  if (!add_time) return true; // si no viene fecha, no filtramos por tiempo
  if (!refDate) return true;
  const t = new Date(add_time).getTime();
  const r = new Date(refDate).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(r)) return true;
  const diffDays = Math.abs((t - r) / (1000 * 60 * 60 * 24));
  return diffDays <= days;
}

async function pdGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${url} -> ${res.status} ${txt}`);
  }
  return res.json();
}

/**
 * Strict: /deals/{id}/files
 */
async function fetchDealFilesStrictOnly(pipedriveBase, token, dealId) {
  const out = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const url = `${pipedriveBase}/deals/${dealId}/files?limit=${limit}&start=${start}&api_token=${token}`;
    const json = await pdGet(url);
    const data = Array.isArray(json?.data) ? json.data : [];

    for (const f of data) {
      // Defensa extra
      if (f.deal_id != null && Number(f.deal_id) !== Number(dealId)) continue;
      if (f.activity_id != null) continue; // no adjuntos de actividades
      if (f.remote_id != null || f.remote_location != null) continue; // no remotos

      const file_name = normalizeName(f.file_name || f.name || null);
      const file_url = f.file_url ?? f.url ?? null;

      out.push({
        id: Number(f.id),
        file_name,
        file_type: f.file_type || null,
        file_url: file_url || null,
        add_time: f.add_time || null,
      });
    }

    const more = json?.additional_data?.pagination?.more_items_in_collection;
    if (more) {
      start = json.additional_data.pagination.next_start;
    } else {
      break;
    }
  }

  // Dedupe por id
  const seen = new Set();
  return out.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

/**
 * Fallback: /files?deal_id= con filtros fuertes
 * - sin remotos ni inline
 * - mime/ext permitidos
 * - ventana temporal ±365 días alrededor de la fecha del deal
 */
async function fetchDealFilesFallback(pipedriveBase, token, dealId, dealRefDate) {
  const out = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const url = `${pipedriveBase}/files?deal_id=${dealId}&limit=${limit}&start=${start}&api_token=${token}`;
    const json = await pdGet(url);
    const data = Array.isArray(json?.data) ? json.data : [];

    for (const f of data) {
      // Excluir remotos/inline
      if (f.inline_flag === true) continue;
      if (f.remote_id != null || f.remote_location != null) continue;

      // Filtrar por mime/ext
      const file_name = normalizeName(f.file_name || f.name || null);
      const file_type = f.file_type || f.mime_type || '';
      if (!isAllowedByMimeOrExt(file_type, file_name)) continue;

      // Ventana temporal
      const add_time = f.add_time || f.update_time || null;

      const file_url =
  f.file_url ?? f.url ?? f.public_url ?? f.download_url ??
  `${pipedriveBase}/files/${f.id}/download?api_token=${token}`;

      out.push({
        id: Number(f.id),
        file_name,
        file_type: file_type || null,
        file_url: file_url || null,
        add_time,
      });
    }

    const more = json?.additional_data?.pagination?.more_items_in_collection;
    if (more) {
      start = json.additional_data.pagination.next_start;
    } else {
      break;
    }
  }

  // Dedupe por id
  const seen = new Set();
  return out.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

/**
 * Modo inteligente: intenta strict y, si no hay resultados, cae a fallback filtrado.
 * @param {string} pipedriveBase
 * @param {string} token
 * @param {number} dealId
 * @param {string|Date|null} dealRefDate  Fecha de referencia (ej: deal.add_time)
 */
async function fetchDealFilesSmart(pipedriveBase, token, dealId, dealRefDate = null) {
  const strict = await fetchDealFilesStrictOnly(pipedriveBase, token, dealId);
  if (strict.length > 0) {
    return { source: 'deals_files_strict_v1', files: strict };
  }
  const fb = await fetchDealFilesFallback(pipedriveBase, token, dealId, dealRefDate);
  return { source: 'files_fallback_v2', files: fb };
}

module.exports = {
  fetchDealFilesSmart,
  // exporto también estas por si se quieren depurar
  fetchDealFilesStrictOnly,
  fetchDealFilesFallback,
};
