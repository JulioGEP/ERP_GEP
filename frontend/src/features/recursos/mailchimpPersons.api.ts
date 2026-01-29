import { ApiError, requestJson } from '../../api/client';
import type { MailchimpPerson } from '../../types/mailchimpPerson';

export type MailchimpPersonSyncSummary = {
  fetched: number;
  imported: number;
  created: number;
  updated: number;
};

type MailchimpPersonListResponse = {
  ok: boolean;
  persons?: unknown;
  message?: string;
  error_code?: string;
};

type MailchimpPersonSyncResponse = {
  ok: boolean;
  summary?: MailchimpPersonSyncSummary | null;
  message?: string;
  error_code?: string;
};

function normalizeLabelIds(value: unknown): string[] {
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

function normalizeMailchimpPerson(row: any): MailchimpPerson {
  if (!row || typeof row !== 'object') {
    throw new ApiError('INVALID_RESPONSE', 'Formato de persona no válido');
  }

  const annualRevenue =
    row.annual_revenue === null || row.annual_revenue === undefined
      ? null
      : Number.parseFloat(String(row.annual_revenue));

  const employeeCount =
    row.employee_count === null || row.employee_count === undefined
      ? null
      : Number.parseInt(String(row.employee_count), 10);

  return {
    person_id: String(row.person_id ?? row.id ?? ''),
    name: String(row.name ?? ''),
    email: row.email ?? null,
    label_ids: normalizeLabelIds(row.label_ids),
    org_id: row.org_id ?? null,
    org_address: row.org_address ?? null,
    size_employees: row.size_employees ?? null,
    segment: row.segment ?? null,
    employee_count: Number.isNaN(employeeCount) ? null : employeeCount,
    annual_revenue: Number.isNaN(annualRevenue) ? null : annualRevenue,
    formacion: row.formacion ?? null,
    servicio: row.servicio ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function fetchMailchimpPersons(): Promise<MailchimpPerson[]> {
  const json = await requestJson<MailchimpPersonListResponse>('/pipedrive-persons');
  const records = Array.isArray(json.persons) ? json.persons : [];
  return records.map((row) => normalizeMailchimpPerson(row));
}

export async function syncMailchimpPersons(): Promise<MailchimpPersonSyncSummary | null> {
  const json = await requestJson<MailchimpPersonSyncResponse>('/pipedrive-persons-sync', {
    method: 'POST',
  });

  return json.summary ?? null;
}
