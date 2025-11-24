// backend/functions/providers.ts
import { randomUUID } from 'crypto';
import type { Handler } from '@netlify/functions';
import { err, json, ok, preflight } from './_lib/http';
import { promises as fs } from 'fs';

const STORAGE_PATH = '/tmp/providers.json';

async function loadProviders() {
  try {
    const raw = await fs.readFile(STORAGE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveProviders(providers: any[]) {
  await fs.writeFile(STORAGE_PATH, JSON.stringify(providers), 'utf8');
}

function normalizeProvider(payload: any) {
  if (!payload || typeof payload !== 'object') return null;
  const nombre_fiscal = String(payload.nombre_fiscal ?? '').trim();
  if (!nombre_fiscal.length) return null;

  const now = new Date().toISOString();
  return {
    provider_id: payload.provider_id ?? randomUUID(),
    nombre_fiscal,
    direccion_fiscal: payload.direccion_fiscal ? String(payload.direccion_fiscal) : null,
    telefono_fiscal: payload.telefono_fiscal ? String(payload.telefono_fiscal) : null,
    mail_empresa: payload.mail_empresa ? String(payload.mail_empresa) : null,
    persona_contacto: payload.persona_contacto ? String(payload.persona_contacto) : null,
    telefono_contacto: payload.telefono_contacto ? String(payload.telefono_contacto) : null,
    mail_contacto: payload.mail_contacto ? String(payload.mail_contacto) : null,
    created_at: payload.created_at ?? now,
    updated_at: now,
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const pathParts = (event.path || '').split('/').filter(Boolean);
  const id = pathParts.length > 2 ? pathParts[pathParts.length - 1] : null;

  try {
    if (event.httpMethod === 'GET') {
      const providers = await loadProviders();
      return ok({ ok: true, providers });
    }

    if (event.httpMethod === 'POST') {
      const payload = event.body ? JSON.parse(event.body) : {};
      const provider = normalizeProvider(payload);
      if (!provider) return err('VALIDATION_ERROR', 'El nombre fiscal es obligatorio', 400);

      const providers = await loadProviders();
      providers.push(provider);
      await saveProviders(providers);
      return ok({ ok: true, provider });
    }

    if (event.httpMethod === 'PATCH') {
      if (!id) return err('VALIDATION_ERROR', 'provider_id requerido', 400);
      const payload = event.body ? JSON.parse(event.body) : {};
      const providers = await loadProviders();
      const index = providers.findIndex((p: any) => p.provider_id === id);
      if (index === -1) return err('NOT_FOUND', 'Proveedor no encontrado', 404);

      const updated = normalizeProvider({ ...providers[index], ...payload, provider_id: id });
      if (!updated) return err('VALIDATION_ERROR', 'El nombre fiscal es obligatorio', 400);

      providers[index] = { ...providers[index], ...updated, updated_at: new Date().toISOString() };
      await saveProviders(providers);
      return ok({ ok: true, provider: providers[index] });
    }

    return json({ ok: false, message: 'Método no permitido' }, 405);
  } catch (error) {
    console.error('providers handler error', error);
    return err('SERVER_ERROR', 'No se pudo procesar la solicitud', 500);
  }
};
