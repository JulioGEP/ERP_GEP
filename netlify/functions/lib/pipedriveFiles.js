// netlify/functions/lib/pipedriveFiles.js
// Trae SOLO adjuntos reales del deal desde /deals/{id}/files (no remotos, no actividades)
const fetch = global.fetch || require('node-fetch');

/**
 * Trae ficheros adjuntos al deal desde /deals/{id}/files,
 * excluye remotos (Drive/Gravatar), excluye adjuntos de actividades,
 * y sanea el file_name (quita querystrings).
 */
async function fetchDealFilesStrict(pipedriveBase, token, dealId) {
  const out = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const url = `${pipedriveBase}/deals/${dealId}/files?limit=${limit}&start=${start}&api_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Pipedrive /deals/${dealId}/files failed: ${res.status} ${txt}`);
    }

    const json = await res.json();
    const data = (json && json.data) ? json.data : [];

    for (const f of data) {
      // Defensa extra (vienen ya filtrados por deal, pero por robustez):
      if (f.deal_id != null && Number(f.deal_id) !== Number(dealId)) continue;
      if (f.activity_id != null) continue; // fuera adjuntos de actividades
      if (f.remote_id != null || f.remote_location != null) continue; // fuera remotos (Drive/links/gravatar)

      // Sanea nombre (quita ?s=512&d=404...)
      let file_name = (f.file_name || '').toString();
      if (file_name.includes('?')) file_name = file_name.split('?')[0];

      const file_url = f.file_url != null ? f.file_url : (f.url != null ? f.url : null);

      out.push({
        id: Number(f.id),
        file_name,
        file_type: f.file_type || null,
        file_url: file_url || null,
        add_time: f.add_time || null,
      });
    }

    const more = json && json.additional_data && json.additional_data.pagination
      ? json.additional_data.pagination.more_items_in_collection
      : false;

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

module.exports = { fetchDealFilesStrict };
