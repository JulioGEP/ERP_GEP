// netlify/functions/deals_import.js
// Importa un deal de Pipedrive, normaliza y persiste en Postgres Neon (serverless).

const crypto = require('crypto');
const fetch = global.fetch || require('node-fetch');

const { COMMON_HEADERS, successResponse, errorResponse } = require('./_shared/response');
const { requireEnv } = require('./_shared/env');
const { neon } = require('@neondatabase/serverless');

// NUEVO: modo "smart" con fallback si /deals/{id}/files viene vacío
const { fetchDealFilesSmart } = require('./lib/pipedriveFiles');

const IMPORTER_VERSION = 'files.smart.2025-09-30.4';

// --- Constantes de mapeo de campos personalizados ---
const ORG_CUSTOM_FIELDS = {
  cif: '6d39d015a33921753410c1bab0b067ca93b8cf2c',
  phone: 'b4379db06dfbe0758d84c2c2dd45ef04fa093b6d',
};

const DEAL_CUSTOM_FIELDS = {
  hours: '38f11c8876ecde803a027fbf3c9041fda2ae7eb7',
  trainingAddress: '8b2a7570f5ba8aa4754f061cd9dc92fd778376a7',
};

const DEAL_OPTION_FIELD_KEYS = {
  sede_label: '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
  caes_label: 'e1971bf3a21d48737b682bf8d864ddc5eb15a351',
  fundae_label: '245d60d4d18aec40ba888998ef92e5d00e494583',
  hotel_label: 'c3a6daf8eb5b4e59c3c07cda8e01f43439101269',
};

const TRAINING_CODE_SNIPPET = 'form-';

// --- Utilidades ---
function readDealId(event) {
  const qs = event.queryStringParameters || {};
  if (qs.dealId) return String(qs.dealId).trim();

  const rawBody = event.body || '';
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();

  if (ct.includes('application/json') && rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.dealId) return String(parsed.dealId).trim();
    } catch (_) {}
  }
  return null;
}

function pipedriveBase() {
  return process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
}

function getRefId(ref) {
  if (ref == null) return null;
  if (typeof ref === 'object') {
    if (ref.value != null) return String(ref.value);
    if (ref.id != null) return String(ref.id);
  }
  return String(ref);
}

function createError(code, message, statusCode = 500) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

async function pipedriveGet(path, params, client) {
  const url = new URL(`${client.base}${path}`);
  url.searchParams.set('api_token', client.token);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  let res;
  try {
    res = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  } catch (_) {
    throw createError('PIPEDRIVE_FETCH_ERROR', `No se pudo conectar con Pipedrive (${path})`, 502);
  }
  let json = null;
  try { json = await res.json(); } catch (_) {}
  const ok = res.ok && json && json.success !== false;
  return { ok, status: res.status, body: json };
}

// --- Fetchers Pipedrive ---
async function fetchDeal(dealId, client) {
  const res = await pipedriveGet(`/deals/${encodeURIComponent(dealId)}`, {}, client);
  if (!res.ok || !res.body?.data) {
    throw createError('PIPEDRIVE_NOT_FOUND', `No se encontró el deal ${dealId} en Pipedrive`, 404);
  }
  return res.body.data;
}

async function fetchOrganization(orgId, client) {
  if (!orgId) return null;
  const res = await pipedriveGet(`/organizations/${encodeURIComponent(orgId)}`, {}, client);
  if (res.status === 404) return null;
  if (!res.ok) throw createError('PIPEDRIVE_ORG_ERROR', `No se pudo recuperar la organización ${orgId}`, res.status || 502);
  return res.body?.data || null;
}

async function fetchPerson(personId, client) {
  if (!personId) return null;
  const res = await pipedriveGet(`/persons/${encodeURIComponent(personId)}`, {}, client);
  if (res.status === 404) return null;
  if (!res.ok) throw createError('PIPEDRIVE_PERSON_ERROR', `No se pudo recuperar la persona ${personId}`, res.status || 502);
  return res.body?.data || null;
}

async function fetchDealProducts(dealId, client) {
  const res = await pipedriveGet(`/deals/${encodeURIComponent(dealId)}/products`, { limit: 500 }, client);
  if (!res.ok) throw createError('PIPEDRIVE_PRODUCTS_ERROR', `No se pudieron recuperar los productos del deal ${dealId}`, res.status || 502);
  return Array.isArray(res.body?.data) ? res.body.data : [];
}

async function fetchDealNotes(dealId, client) {
  const res = await pipedriveGet('/notes', { deal_id: dealId, start: 0, limit: 500 }, client);
  if (!res.ok) throw createError('PIPEDRIVE_NOTES_ERROR', `No se pudieron recuperar las notas del deal ${dealId}`, res.status || 502);
  return Array.isArray(res.body?.data) ? res.body.data : [];
}

// --- LEGACY (NO USAR) ---
async function fetchDealFilesLegacy(dealId, client) {
  const res = await pipedriveGet('/files', { deal_id: dealId, start: 0, limit: 500 }, client);
  if (!res.ok) throw createError('PIPEDRIVE_FILES_ERROR', `No se pudieron recuperar los documentos del deal ${dealId}`, res.status || 502);
  return Array.isArray(res.body?.data) ? res.body.data : [];
}

async function fetchDealFields(client) {
  const res = await pipedriveGet('/dealFields', { limit: 500 }, client);
  if (!res.ok) throw createError('PIPEDRIVE_FIELDS_ERROR', 'No se pudo recuperar el catálogo de campos de deals', res.status || 502);
  const fields = Array.isArray(res.body?.data) ? res.body.data : [];
  const map = new Map();
  fields.forEach(field => { if (field?.key) map.set(String(field.key), field); });
  return map;
}

// --- Schema (Neon serverless) ---
async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      org_id TEXT PRIMARY KEY,
      name TEXT,
      cif TEXT,
      phone TEXT,
      address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cif TEXT;`;
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT;`;
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address TEXT;`;
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE organizations ALTER COLUMN created_at SET DEFAULT now();`;
  await sql`ALTER TABLE organizations ALTER COLUMN updated_at SET DEFAULT now();`;
  await sql`UPDATE organizations SET created_at = now() WHERE created_at IS NULL;`;
  await sql`UPDATE organizations SET updated_at = now() WHERE updated_at IS NULL;`;

  await sql`
    CREATE TABLE IF NOT EXISTS persons (
      person_id TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      org_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS first_name TEXT;`;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS last_name TEXT;`;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS email TEXT;`;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS phone TEXT;`;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS org_id TEXT;`;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE persons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE persons ALTER COLUMN created_at SET DEFAULT now();`;
  await sql`ALTER TABLE persons ALTER COLUMN updated_at SET DEFAULT now();`;
  await sql`UPDATE persons SET created_at = now() WHERE created_at IS NULL;`;
  await sql`UPDATE persons SET updated_at = now() WHERE updated_at IS NULL;`;

  await sql`
    CREATE TABLE IF NOT EXISTS deals (
      deal_id TEXT PRIMARY KEY,
      title TEXT,
      pipeline_id TEXT,
      hours TEXT,
      training_address TEXT,
      sede_label TEXT,
      caes_label TEXT,
      fundae_label TEXT,
      hotel_label TEXT,
      org_id TEXT,
      person_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS title TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS hours TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS training_address TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS sede_label TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS caes_label TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS fundae_label TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS hotel_label TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS org_id TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS person_id TEXT;`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE deals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE deals ALTER COLUMN created_at SET DEFAULT now();`;
  await sql`ALTER TABLE deals ALTER COLUMN updated_at SET DEFAULT now();`;
  await sql`UPDATE deals SET created_at = now() WHERE created_at IS NULL;`;
  await sql`UPDATE deals SET updated_at = now() WHERE updated_at IS NULL;`;

  await sql`
    CREATE TABLE IF NOT EXISTS deal_products (
      id TEXT PRIMARY KEY,
      deal_id TEXT,
      product_id TEXT,
      name TEXT,
      code TEXT,
      quantity NUMERIC,
      price NUMERIC,
      is_training BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS deal_id TEXT;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS product_id TEXT;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS name TEXT;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS code TEXT;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS quantity NUMERIC;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS price NUMERIC;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS is_training BOOLEAN;`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE deal_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`;

  await sql`
    CREATE TABLE IF NOT EXISTS deal_notes (
      id TEXT PRIMARY KEY,
      deal_id TEXT,
      product_id TEXT,
      content TEXT,
      author TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `;
  await sql`ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS deal_id TEXT;`;
  await sql`ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS product_id TEXT;`;
  await sql`ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS content TEXT;`;
  await sql`ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS author TEXT;`;
  await sql`ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;`;
  await sql`ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`;

  await sql`
    CREATE TABLE IF NOT EXISTS deal_files (
      id TEXT PRIMARY KEY,
      deal_id TEXT,
      product_id TEXT,
      file_name TEXT,
      file_url TEXT,
      file_type TEXT,
      added_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS deal_id TEXT;`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS product_id TEXT;`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS file_name TEXT;`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS file_url TEXT;`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS file_type TEXT;`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
  await sql`ALTER TABLE deal_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`;
}

// --- Helpers de mapeo/normalización ---
function optionValueToArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(v => (v != null ? String(v) : '')).filter(Boolean);
  const stringValue = String(value).trim();
  if (!stringValue) return [];
  if (stringValue.includes(',')) {
    return stringValue.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [stringValue];
}

function mapOptionLabel(field, rawValue) {
  if (!field) return null;
  const options = Array.isArray(field.options) ? field.options : [];
  if (!options.length) return rawValue == null ? null : String(rawValue);
  const asArray = optionValueToArray(rawValue);
  if (!asArray.length) return null;
  const labels = asArray
    .map(id => {
      const match = options.find(opt => String(opt.id) === id || String(opt.id) === String(Number(id)));
      return match ? String(match.label) : null;
    })
    .filter(Boolean);
  if (!labels.length) return null;
  return labels.join(', ');
}

function pickPrimary(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const primary = items.find(item => item?.primary);
  return primary || items[0];
}

function toNullableString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function toNullableNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractProductCode(product) {
  if (!product) return null;
  if (product.code != null) return toNullableString(product.code);
  if (product.sku != null) return toNullableString(product.sku);
  return null;
}

function firstPinnedProductId(note) {
  const pinned = note?.pinned_to_products;
  if (Array.isArray(pinned) && pinned.length) {
    const first = pinned[0];
    if (first && typeof first === 'object') {
      if (first.product_id != null) return String(first.product_id);
      if (first.id != null) return String(first.id);
    }
  }
  return null;
}

// --- Handler ---
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Solo se permite POST', 405);
  }

  const requestId = crypto.randomUUID();
  console.time(`[${requestId}] deals_import`);

  try {
    const DATABASE_URL = requireEnv('DATABASE_URL');
    const PIPEDRIVE_API_TOKEN = requireEnv('PIPEDRIVE_API_TOKEN');

    const dealId = readDealId(event);
    if (!dealId) return errorResponse('VALIDATION_ERROR', 'Falta dealId', 400);

    const client = { base: pipedriveBase(), token: PIPEDRIVE_API_TOKEN };

    // 1) Entidades base
    const deal = await fetchDeal(dealId, client);
    const dealFieldsCatalog = await fetchDealFields(client);

    const orgId = getRefId(deal.org_id ?? deal.orgId);
    const personId = getRefId(deal.person_id ?? deal.personId);

    const [organization, person, products, notes] = await Promise.all([
      fetchOrganization(orgId, client),
      fetchPerson(personId, client),
      fetchDealProducts(dealId, client),
      fetchDealNotes(dealId, client),
    ]);

    // 2) DB
    const sql = neon(DATABASE_URL);
    await ensureSchema(sql);

    // 3) Organización
    let orgSummary = null;
    if (orgId) {
      const orgName = toNullableString(organization?.name) || 'Organización sin nombre';
      const orgCif = toNullableString(organization?.[ORG_CUSTOM_FIELDS.cif]);
      const orgPhone = toNullableString(organization?.[ORG_CUSTOM_FIELDS.phone]);
      const orgAddress = toNullableString(organization?.address);

      await sql`
        INSERT INTO organizations (org_id, name, cif, phone, address)
        VALUES (${orgId}, ${orgName}, ${orgCif}, ${orgPhone}, ${orgAddress})
        ON CONFLICT (org_id) DO UPDATE
        SET name = EXCLUDED.name,
            cif = EXCLUDED.cif,
            phone = EXCLUDED.phone,
            address = EXCLUDED.address,
            updated_at = now()
      `;
      orgSummary = { org_id: orgId, name: orgName, cif: orgCif };
    }

    // 4) Persona
    let personSummary = null;
    if (personId && person) {
      const firstName = toNullableString(person.first_name);
      const lastName = toNullableString(person.last_name);
      const emailPrimary = pickPrimary(person.email);
      const phonePrimary = pickPrimary(person.phone);
      const emailValue = toNullableString(emailPrimary?.value ?? emailPrimary?.email);
      const phoneValue = toNullableString(phonePrimary?.value ?? phonePrimary?.phone);

      await sql`
        INSERT INTO persons (person_id, first_name, last_name, email, phone, org_id)
        VALUES (${personId}, ${firstName}, ${lastName}, ${emailValue}, ${phoneValue}, ${orgId})
        ON CONFLICT (person_id) DO UPDATE
        SET first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            org_id = EXCLUDED.org_id,
            updated_at = now()
      `;

      personSummary = { person_id: personId, first_name: firstName, last_name: lastName, email: emailValue, phone: phoneValue };
    }

    // 5) Deal + option labels
    const dealTitle = toNullableString(deal.title) || `Presupuesto #${deal.id ?? dealId}`;
    const pipelineId = toNullableString(deal.pipeline_id);
    const hours = toNullableString(deal[DEAL_CUSTOM_FIELDS.hours]);
    const trainingAddress = toNullableString(deal[DEAL_CUSTOM_FIELDS.trainingAddress]);

    const optionLabels = {};
    Object.entries(DEAL_OPTION_FIELD_KEYS).forEach(([summaryKey, fieldKey]) => {
      const field = dealFieldsCatalog.get(fieldKey);
      optionLabels[summaryKey] = mapOptionLabel(field, deal[fieldKey]);
    });

    await sql`
      INSERT INTO deals (deal_id, title, pipeline_id, hours, training_address, sede_label, caes_label, fundae_label, hotel_label, org_id, person_id)
      VALUES (${String(dealId)}, ${dealTitle}, ${pipelineId}, ${hours}, ${trainingAddress},
              ${optionLabels.sede_label}, ${optionLabels.caes_label}, ${optionLabels.fundae_label}, ${optionLabels.hotel_label},
              ${orgId}, ${personId})
      ON CONFLICT (deal_id) DO UPDATE
      SET title = EXCLUDED.title,
          pipeline_id = EXCLUDED.pipeline_id,
          hours = EXCLUDED.hours,
          training_address = EXCLUDED.training_address,
          sede_label = EXCLUDED.sede_label,
          caes_label = EXCLUDED.caes_label,
          fundae_label = EXCLUDED.fundae_label,
          hotel_label = EXCLUDED.hotel_label,
          org_id = EXCLUDED.org_id,
          person_id = EXCLUDED.person_id,
          updated_at = now()
    `;

    // 6) Productos
    const trainingProducts = [];
    const extraProducts = [];
    for (const product of products) {
      const dealProductId = toNullableString(product.id);
      if (!dealProductId) continue;
      const productId = toNullableString(product.product_id ?? product.productId);
      const productName = toNullableString(product.name ?? product.product?.name);
      const productCode = extractProductCode(product.product ?? product);
      const quantity = toNullableNumber(product.quantity);
      const price = toNullableNumber(product.item_price ?? product.price);
      const isTraining = productCode ? productCode.toLowerCase().includes(TRAINING_CODE_SNIPPET) : false;

      await sql`
        INSERT INTO deal_products (id, deal_id, product_id, name, code, quantity, price, is_training)
        VALUES (${dealProductId}, ${String(dealId)}, ${productId}, ${productName}, ${productCode}, ${quantity}, ${price}, ${isTraining})
        ON CONFLICT (id) DO UPDATE
        SET deal_id = EXCLUDED.deal_id,
            product_id = EXCLUDED.product_id,
            name = EXCLUDED.name,
            code = EXCLUDED.code,
            quantity = EXCLUDED.quantity,
            price = EXCLUDED.price,
            is_training = EXCLUDED.is_training,
            updated_at = now()
      `;

      const productSummary = { id: dealProductId, product_id: productId, name: productName, code: productCode, quantity: quantity ?? 0, price };
      (isTraining ? trainingProducts : extraProducts).push(productSummary);
    }
    const trainingSessions = trainingProducts.reduce((acc, item) => acc + (item.quantity || 0), 0);

    // 7) Notas
    const noteSummaries = [];
    for (const note of notes) {
      const noteId = toNullableString(note.id);
      if (!noteId) continue;
      const content = toNullableString(note.content);
      const author = toNullableString(note.user?.name ?? note.user_name);
      const pinnedProductId = firstPinnedProductId(note);
      const createdAt = note.add_time ? new Date(note.add_time) : null;
      const updatedAt = note.update_time ? new Date(note.update_time) : createdAt;

      await sql`
        INSERT INTO deal_notes (id, deal_id, product_id, content, author, created_at, updated_at)
        VALUES (${noteId}, ${String(dealId)}, ${pinnedProductId}, ${content}, ${author}, ${createdAt}, ${updatedAt})
        ON CONFLICT (id) DO UPDATE
        SET deal_id = EXCLUDED.deal_id,
            product_id = EXCLUDED.product_id,
            content = EXCLUDED.content,
            author = EXCLUDED.author,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
      `;
      noteSummaries.push({ id: noteId, product_id: pinnedProductId, has_product_link: Boolean(pinnedProductId) });
    }

    // 8) Ficheros (modo inteligente: strict -> fallback)
    const refDate = deal.add_time || deal.update_time || null;
    const { source: filesSource, files: smartFiles } =
      await fetchDealFilesSmart(pipedriveBase(), PIPEDRIVE_API_TOKEN, Number(dealId), refDate);

    const fileSummaries = [];
    for (const file of smartFiles) {
      const fileId = toNullableString(file.id);
      if (!fileId) continue;
      const fileName = toNullableString(file.file_name ?? file.name);
      const fileUrl = toNullableString(file.file_url ?? file.url ?? file.public_url ?? file.download_url);
      const fileType = toNullableString(file.file_type ?? file.mime_type);
      const productId = null; // no vínculo a línea de producto
      const addedAt = file.add_time ? new Date(file.add_time) : null;

      await sql`
        INSERT INTO deal_files (id, deal_id, product_id, file_name, file_url, file_type, added_at)
        VALUES (${fileId}, ${String(dealId)}, ${productId}, ${fileName}, ${fileUrl}, ${fileType}, ${addedAt})
        ON CONFLICT (id) DO UPDATE
        SET deal_id = EXCLUDED.deal_id,
            product_id = EXCLUDED.product_id,
            file_name = EXCLUDED.file_name,
            file_url = EXCLUDED.file_url,
            file_type = EXCLUDED.file_type,
            added_at = EXCLUDED.added_at,
            updated_at = now()
      `;
      fileSummaries.push({ id: fileId, product_id: productId, file_name: fileName });
    }

    // 9) Summary
    const summary = {
      importer_version: IMPORTER_VERSION,
      deal_id: String(dealId),
      title: dealTitle,
      pipeline_id: pipelineId,
      hours,
      training_address: trainingAddress,
      labels: optionLabels,
      organization: orgSummary,
      person: personSummary,
      training_products: trainingProducts,
      extra_products: extraProducts,
      training_sessions: trainingSessions,
      notes: noteSummaries,
      files: fileSummaries,
      filesSource,
    };

    return successResponse({ ok: true, deal_id: String(dealId), summary }, 200);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const code = err.code || 'UNEXPECTED_ERROR';
    const message = err.message || 'Error inesperado';
    return errorResponse(code, message, statusCode);
  } finally {
    console.timeEnd(`[${requestId}] deals_import`);
  }
};
