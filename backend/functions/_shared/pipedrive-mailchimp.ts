import { Prisma } from '@prisma/client';
import { getOrganization } from './pipedrive';

const SIZE_EMPLOYEES_FIELD = 'd114c1adf4f424881f6784faf685f1e1aec7cdf4';
const SEGMENT_FIELD = 'c675b8535afadbd89b154a3b8eb68124a3409368';
const FORMACION_FIELD = 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab';
const SERVICIO_FIELD = '1d78d202448ee549a86e0881ec06f3ff7842c5ea';

type OrgCache = Map<string, string | null>;

export type MailchimpPersonInput = {
  person_id: string;
  name: string;
  email: string | null;
  label_ids: Prisma.InputJsonValue | null;
  org_id: string | null;
  org_address: string | null;
  size_employees: string | null;
  segment: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  formacion: string | null;
  servicio: string | null;
};

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickFirstEmail(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length > 0) {
    const first = value.find((entry) => entry?.primary) ?? value[0];
    return normalizeText(first?.value ?? first?.email);
  }
  if (typeof value === 'object') {
    return normalizeText((value as any).value ?? (value as any).email);
  }
  return null;
}

function normalizeLabelIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter((item): item is string => Boolean(item));
  }
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function extractOrgId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return normalizeText(value);
  }
  if (typeof value === 'object') {
    const candidate = (value as any).value ?? (value as any).id ?? (value as any).org_id;
    return normalizeText(candidate);
  }
  return null;
}

function extractOrgAddress(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  return normalizeText((value as any).address ?? (value as any).address_formatted);
}

async function resolveOrgAddress(orgId: string, cache: OrgCache): Promise<string | null> {
  if (cache.has(orgId)) return cache.get(orgId) ?? null;
  const org = await getOrganization(orgId).catch(() => null);
  const address = normalizeText(org?.address ?? (org as any)?.address_formatted);
  cache.set(orgId, address ?? null);
  return address ?? null;
}

export async function buildMailchimpPersonInput(
  raw: any,
  cache: OrgCache,
): Promise<MailchimpPersonInput | null> {
  const personId = normalizeText(raw?.id);
  if (!personId) return null;

  const name =
    normalizeText(raw?.name) ??
    normalizeText([raw?.first_name, raw?.last_name].filter(Boolean).join(' ')) ??
    personId;
  const email = pickFirstEmail(raw?.email);
  const labelIds = normalizeLabelIds(raw?.label_ids);
  const orgId = extractOrgId(raw?.org_id);
  const orgAddressFromPayload = extractOrgAddress(raw?.org_id);
  const orgAddress = orgId
    ? orgAddressFromPayload ?? (await resolveOrgAddress(orgId, cache))
    : orgAddressFromPayload;

  return {
    person_id: personId,
    name,
    email,
    label_ids: labelIds.length ? labelIds : null,
    org_id: orgId,
    org_address: orgAddress,
    size_employees: normalizeText(raw?.[SIZE_EMPLOYEES_FIELD]),
    segment: normalizeText(raw?.[SEGMENT_FIELD]),
    employee_count: normalizeInteger(raw?.employee_count),
    annual_revenue: normalizeNumber(raw?.annual_revenue),
    formacion: normalizeText(raw?.[FORMACION_FIELD]),
    servicio: normalizeText(raw?.[SERVICIO_FIELD]),
  };
}
