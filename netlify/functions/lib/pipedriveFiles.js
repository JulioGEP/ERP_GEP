// netlify/functions/lib/pipedriveFiles.js
// Modo "smart": usa /deals/{id}/files y, si viene vacío, cae a /files?deal_id= con filtros.
// Incluye timeout, límite de páginas y tope de ficheros para evitar 504 en Netlify.

const fetch = global.fetch || require('node-fetch');
const DEFAULT_FETCH_TIMEOUT_MS = 4500;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // xlsx
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'text/csv',
  'application/rtf',
]);

const ALLOWED_EXT = new Set([
  'pdf','png','jpg','jpeg','heic',
  'doc','docx','xls','xlsx','ppt','pptx',
  'csv','rtf'
]);

const MAX_FILES = 20; // límite duro para evitar timeouts en Netlify

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

async function pdGet(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(new Error('fetch-timeout')), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${url} -> ${res.status} ${txt}`);
    }
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

/**
 * Strict: /deals/{id}/files
 */
async function fetchDealFilesStrictOnly(pipedriveBase, token, dealId) {
  const out = [];
  let start = 0;
  const limit = 50;

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
      if (out.length >= MAX_FILES) break;
    }

    if (out.length >= MAX_FILES) break;

    const more = json?.additional_data?.pagination?.more_items_in_collection;
    if (more) {
      start = json.additional_data.pagination.next_start;
    } else {
      break;
    }
  }

  // Dedupe por id y cap
  const seen = new Set();
  const deduped = out.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  return deduped.slice(0, MAX_FILES);
}

/**
 * Fallback: /files?deal_id= con filtros por tipo (pdf/img/office),
 * sin filtrar por fecha ni inline/remotos, máx. 3 páginas y 20 ficheros.
 */
async function fetchDealFilesFallback(pipedriveBase, token, dealId, dealRefDate) {
  const out = [];
  let start = 0;
  const limit = 50; // páginas más pequeñas para ir rápido

  for (let page = 0; page < 3; page++) {
    if (out.length >= MAX_FILES) break;

    const url = `${pipedriveBase}/files?deal_id=${dealId}&limit=${limit}&start=${start}&api_token=${token}`;
    const json = await pdGet(url);
    const data = Array.isArray(json?.data) ? json.data : [];

    for (const f of data) {
      if (out.length >= MAX_FILES) break;

      // NO filtramos inline ni remotos; solo por tipo permitido
      const file_name = normalizeName(f.file_name || f.name || null);
      const file_type = f.file_type || f.mime_type || '';
      if (!isAllowedByMimeOrExt(file_type, file_name)) continue;

      const add_time = f.add_time || f.update_time || f.added_at || null; // sin filtro temporal
      const file_url = f.file_url ?? f.url ?? f.public_url ?? f.download_url ?? null;

      out.push({
        id: Number(f.id),
        file_name,
        file_type: file_type || null,
        file_url: file_url || null,
        add_time,
      });
    }

    const more = json?.additional_data?.pagination?.more_items_in_collection;
    if (more && out.length < MAX_FILES) {
      start = json.additional_data.pagination.next_start;
    } else {
      break;
    }
  }

  // Dedupe y cap final
  const seen = new Set();
  const deduped = out.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  return deduped.slice(0, MAX_FILES);
}

/**
 * Modo inteligente: intenta strict y, si no hay resultados, cae a fallback filtrado.
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
  fetchDealFilesStrictOnly,
  fetchDealFilesFallback,
};
