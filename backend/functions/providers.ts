// backend/functions/providers.ts
import type { Handler } from '@netlify/functions';
import type { Prisma, proveedores } from '@prisma/client';
import { err, json, ok, preflight } from './_lib/http';
import { getPrisma } from './_shared/prisma';

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function mapProvider(row: proveedores) {
  return {
    provider_id: String(row.provider_id),
    nombre_fiscal: row.nombre_fiscal,
    direccion_fiscal: row.direccion_fiscal ?? null,
    telefono_fiscal: row.telefono_fiscal ?? null,
    mail_empresa: row.mail_empresa ?? null,
    persona_contacto: row.persona_contacto ?? null,
    telefono_contacto: row.telefono_contacto ?? null,
    mail_contacto: row.mail_contacto ?? null,
    created_at: row.created_at?.toISOString?.() ?? null,
    updated_at: row.updated_at?.toISOString?.() ?? null,
  };
}

function buildCreateData(payload: any): Prisma.proveedoresUncheckedCreateInput | null {
  const nombre_fiscal = String(payload?.nombre_fiscal ?? '').trim();
  if (!nombre_fiscal) return null;

  return {
    nombre_fiscal,
    direccion_fiscal: toNullableString(payload?.direccion_fiscal),
    telefono_fiscal: toNullableString(payload?.telefono_fiscal),
    mail_empresa: toNullableString(payload?.mail_empresa),
    persona_contacto: toNullableString(payload?.persona_contacto),
    telefono_contacto: toNullableString(payload?.telefono_contacto),
    mail_contacto: toNullableString(payload?.mail_contacto),
  };
}

function buildUpdateData(payload: any): Prisma.proveedoresUncheckedUpdateInput | null {
  const data: Prisma.proveedoresUncheckedUpdateInput = { updated_at: new Date() };

  if ('nombre_fiscal' in payload) {
    const nombre_fiscal = String(payload?.nombre_fiscal ?? '').trim();
    if (!nombre_fiscal) return null;
    data.nombre_fiscal = nombre_fiscal;
  }

  if ('direccion_fiscal' in payload) data.direccion_fiscal = toNullableString(payload?.direccion_fiscal);
  if ('telefono_fiscal' in payload) data.telefono_fiscal = toNullableString(payload?.telefono_fiscal);
  if ('mail_empresa' in payload) data.mail_empresa = toNullableString(payload?.mail_empresa);
  if ('persona_contacto' in payload) data.persona_contacto = toNullableString(payload?.persona_contacto);
  if ('telefono_contacto' in payload) data.telefono_contacto = toNullableString(payload?.telefono_contacto);
  if ('mail_contacto' in payload) data.mail_contacto = toNullableString(payload?.mail_contacto);

  return data;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const pathParts = (event.path || '').split('/').filter(Boolean);
  const id = pathParts.length > 2 ? pathParts[pathParts.length - 1] : null;
  const prisma = getPrisma();

  try {
    if (event.httpMethod === 'GET') {
      const providers = await prisma.proveedores.findMany({ orderBy: { created_at: 'desc' } });
      return ok({ ok: true, providers: providers.map(mapProvider) });
    }

    if (event.httpMethod === 'POST') {
      const payload = event.body ? JSON.parse(event.body) : {};
      const data = buildCreateData(payload);
      if (!data) return err('VALIDATION_ERROR', 'El nombre fiscal es obligatorio', 400);
      const created = await prisma.proveedores.create({ data });
      return ok({ ok: true, provider: mapProvider(created) });
    }

    if (event.httpMethod === 'PATCH') {
      if (!id) return err('VALIDATION_ERROR', 'provider_id requerido', 400);
      const providerId = Number(id);
      if (!Number.isInteger(providerId)) return err('VALIDATION_ERROR', 'provider_id inválido', 400);
      const payload = event.body ? JSON.parse(event.body) : {};
      const existing = await prisma.proveedores.findUnique({ where: { provider_id: providerId } });
      if (!existing) return err('NOT_FOUND', 'Proveedor no encontrado', 404);

      const data = buildUpdateData(payload);
      if (!data) return err('VALIDATION_ERROR', 'El nombre fiscal es obligatorio', 400);
      const updated = await prisma.proveedores.update({ where: { provider_id: providerId }, data });
      return ok({ ok: true, provider: mapProvider(updated) });
    }

    return json({ ok: false, message: 'Método no permitido' }, 405);
  } catch (error) {
    console.error('providers handler error', error);
    return err('SERVER_ERROR', 'No se pudo procesar la solicitud', 500);
  }
};
