import type { Handler } from '@netlify/functions';
import type { Prisma } from '@prisma/client';
import { err, ok, preflight } from './_lib/http';
import { getPrisma } from './_shared/prisma';

function normalizeLabelIds(value: Prisma.JsonValue | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item).trim()))
      .filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? [trimmed] : [];
  }
  return [];
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  if (event.httpMethod !== 'GET') {
    return err('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  try {
    const prisma = getPrisma();
    const records = await prisma.pipedrive_mailchimp_persons.findMany({
      orderBy: { name: 'asc' },
    });

    const persons = records.map((row) => {
      const annualRevenueValue = row.annual_revenue ? Number(row.annual_revenue) : null;
      return {
        person_id: row.person_id,
        name: row.name,
        email: row.email ?? null,
        label_ids: normalizeLabelIds(row.label_ids),
        org_id: row.org_id ?? null,
        org_address: row.org_address ?? null,
        size_employees: row.size_employees ?? null,
        segment: row.segment ?? null,
        employee_count: row.employee_count ?? null,
        annual_revenue: Number.isFinite(annualRevenueValue) ? annualRevenueValue : null,
        formacion: row.formacion ?? null,
        servicio: row.servicio ?? null,
        created_at: row.created_at?.toISOString?.() ?? null,
        updated_at: row.updated_at?.toISOString?.() ?? null,
      };
    });

    return ok({ ok: true, persons });
  } catch (error) {
    console.error('[pipedrive-persons] handler error', error);
    return err('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
