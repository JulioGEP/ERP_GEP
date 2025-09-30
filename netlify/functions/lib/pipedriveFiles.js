// netlify/functions/lib/pipedriveFiles.js
// Módulo CommonJS para traer SOLO adjuntos reales del deal desde /deals/{id}/files
// y hacer upsert en Neon (si alguna vez usamos pg PoolClient).
const fetch = global.fetch || require('node-fetch');

/**
 * Trae solo ficheros adjuntos al deal desde /deals/{id}/files,
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

/**
 * Upsert en Neon usando un PoolClient de 'pg'.
 * En este proyecto usamos 'neon(sql)' en el handler, por lo que
 * normalmente NO llamamos a esta función desde deals_import.js.
 * Se deja disponible si más adelante migramos a pg PoolClient.
 */
async function upsertDealFiles(pgClient, dealId, files) {
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS deal_files (
      id BIGINT PRIMARY KEY,
      deal_id BIGINT NOT NULL,
      product_id BIGINT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NULL,
      file_type TEXT NULL,
      added_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  for (const f of files) {
    await pgClient.query(
      `
      INSERT INTO deal_files (id, deal_id, product_id, file_name, file_url, file_type, added_at, created_at, updated_at)
      VALUES ($1, $2, NULL, $3, $4, $5, $6, now(), now())
      ON CONFLICT (id) DO UPDATE
      SET deal_id = EXCLUDED.deal_id,
          product_id = NULL,
          file_name = EXCLUDED.file_name,
          file_url = EXCLUDED.file_url,
          file_type = EXCLUDED.file_type,
          added_at = EXCLUDED.added_at,
          updated_at = now();
      `,
      [
        f.id,
        Number(dealId),
        f.file_name || '',
        f.file_url || null,
        f.file_type || null,
        f.add_time ? new Date(f.add_time) : null,
      ]
    );
  }

  const ids = files.map(f => f.id);
  await pgClient.query(
    `DELETE FROM deal_files WHERE deal_id = $1 AND id <> ALL($2::bigint[])`,
    [Number(dealId), ids.length ? ids : [0]]
  );
}

module.exports = {
  fetchDealFilesStrict,
  upsertDealFiles,
};
