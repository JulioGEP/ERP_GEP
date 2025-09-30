// netlify/functions/deals.js
// Lista TODOS los deals (sin filtrar por sesiones). JOIN seguro casteando org_id a text.

const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { requireEnv } = require('./_shared/env');
const { neon } = require('@neondatabase/serverless');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  if (event.httpMethod !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'Solo se permite GET', 405);

  try {
    const DATABASE_URL = requireEnv('DATABASE_URL');
    const sql = neon(DATABASE_URL);

    // Aseguramos existencia (si el import aún no ha creado tablas)
    await sql`CREATE TABLE IF NOT EXISTS organizations (org_id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMPTZ DEFAULT now() NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() NOT NULL);`;
    await sql`CREATE TABLE IF NOT EXISTS deals (deal_id TEXT PRIMARY KEY, title TEXT, org_id TEXT, created_at TIMESTAMPTZ DEFAULT now() NOT NULL, updated_at TIMESTAMPTZ DEFAULT now() NOT NULL);`;

    // Columnas realmente existentes
    const dcols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'deals'`;
    const ocols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations'`;
    const dHasTitle = dcols.some(c => String(c.column_name) === 'title');
    const dHasOrgId = dcols.some(c => String(c.column_name) === 'org_id');
    const dHasUpdated = dcols.some(c => String(c.column_name) === 'updated_at');
    const dHasCreated = dcols.some(c => String(c.column_name) === 'created_at');
    const oHasOrgId = ocols.some(c => String(c.column_name) === 'org_id');
    const oHasName  = ocols.some(c => String(c.column_name) === 'name');

    // Query tolerante a tipos distintos (text/bigint) con CAST a text en el JOIN
    let rows = [];
    if (dHasOrgId && oHasOrgId) {
      rows = await sql`
        SELECT
          d.deal_id,
          ${dHasTitle ? sql`d.title` : sql`NULL AS title`},
          d.org_id,
          ${oHasName ? sql`o.name AS org_name` : sql`NULL AS org_name`}
        FROM deals d
        LEFT JOIN organizations o
          ON o.org_id::text = d.org_id::text
        ORDER BY
          ${dHasUpdated ? sql`d.updated_at DESC,` : sql``}
          ${dHasCreated ? sql`d.created_at DESC,` : sql``}
          d.deal_id::text DESC
        LIMIT 500
      `;
    } else {
      rows = await sql`
        SELECT
          d.deal_id,
          ${dHasTitle ? sql`d.title` : sql`NULL AS title`}
        FROM deals d
        ORDER BY
          ${dHasUpdated ? sql`d.updated_at DESC,` : sql``}
          ${dHasCreated ? sql`d.created_at DESC,` : sql``}
          d.deal_id::text DESC
        LIMIT 500
      `;
    }

    return successResponse({ ok: true, deals: rows }, 200);
  } catch (err) {
    return errorResponse('UNEXPECTED_ERROR', err.message || 'Error inesperado', 500);
  }
};
