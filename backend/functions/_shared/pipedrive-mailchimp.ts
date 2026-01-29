import { Prisma } from '@prisma/client';
import { findFieldDef, getOrganization, getOrganizationFields, getPersonLabels, optionLabelOf } from './pipedrive';

const SIZE_EMPLOYEES_FIELD = 'd114c1adf4f424881f6784faf685f1e1aec7cdf4';
const SEGMENT_FIELD = 'c675b8535afadbd89b154a3b8eb68124a3409368';
const FORMACION_FIELD = 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab';
const SERVICIO_FIELD = '1d78d202448ee549a86e0881ec06f3ff7842c5ea';

type OrgCache = {
  organizations: Map<string, any | null>;
  orgFieldDefs?: any[] | null;
  personLabels?: Map<string, string>;
};

export type MailchimpPersonInput = {
  person_id: string;
  name: string;
  email: string | null;
  label_ids: Prisma.InputJsonValue | null;
  org_id: string | null;
  org_name: string | null;
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

function extractOrgName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  return normalizeText((value as any).name ?? (value as any).org_name);
}

async function resolveOrganization(orgId: string, cache: OrgCache): Promise<any | null> {
  if (cache.organizations.has(orgId)) return cache.organizations.get(orgId) ?? null;
  const org = await getOrganization(orgId).catch(() => null);
  cache.organizations.set(orgId, org ?? null);
  return org ?? null;
}

async function resolveOrgFieldDefs(cache: OrgCache): Promise<any[] | null> {
  if (cache.orgFieldDefs !== undefined) return cache.orgFieldDefs ?? null;
  const defs = await getOrganizationFields().catch(() => null);
  cache.orgFieldDefs = Array.isArray(defs) ? defs : null;
  return cache.orgFieldDefs ?? null;
}

async function resolvePersonLabelMap(cache: OrgCache): Promise<Map<string, string>> {
  if (cache.personLabels) return cache.personLabels;
  const labels = await getPersonLabels().catch(() => []);
  const list = Array.isArray(labels) ? labels : [];
  const map = new Map<string, string>();
  for (const label of list) {
    const id = normalizeText((label as any)?.id ?? (label as any)?.value);
    const name = normalizeText((label as any)?.name ?? (label as any)?.label);
    if (id && name) map.set(id, name);
  }
  cache.personLabels = map;
  return map;
}

function resolveOrgTextField(
  org: any | null,
  fallback: unknown,
  fieldKey: string,
  fieldDefs: any[] | null,
): string | null {
  const value = org?.[fieldKey] ?? fallback;
  if (value == null) return null;
  const fieldDef = fieldDefs ? findFieldDef(fieldDefs, fieldKey) : null;
  const optionLabel = fieldDef ? optionLabelOf(fieldDef, value) : undefined;
  return normalizeText(optionLabel ?? value);
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
  const labelMap = labelIds.length ? await resolvePersonLabelMap(cache) : null;
  const labelNames = labelIds
    .map((label) => (labelMap?.get(label) ? labelMap?.get(label) : label))
    .filter((label): label is string => Boolean(label));
  const orgId = extractOrgId(raw?.org_id);
  const orgFromPayload = orgId ? await resolveOrganization(orgId, cache) : null;
  const orgFieldDefs = await resolveOrgFieldDefs(cache);
  const orgAddressFromPayload = extractOrgAddress(raw?.org_id);
  const orgNameFromPayload = extractOrgName(raw?.org_id);
  const orgAddress = orgId
    ? orgAddressFromPayload ??
      normalizeText(orgFromPayload?.address ?? (orgFromPayload as any)?.address_formatted)
    : orgAddressFromPayload;
  const orgName =
    orgNameFromPayload ?? normalizeText(orgFromPayload?.name ?? (orgFromPayload as any)?.org_name);

  return {
    person_id: personId,
    name,
    email,
    label_ids: labelNames.length ? labelNames : null,
    org_id: orgId,
    org_name: orgName,
    org_address: orgAddress,
    size_employees: resolveOrgTextField(orgFromPayload, raw?.[SIZE_EMPLOYEES_FIELD], SIZE_EMPLOYEES_FIELD, orgFieldDefs),
    segment: resolveOrgTextField(orgFromPayload, raw?.[SEGMENT_FIELD], SEGMENT_FIELD, orgFieldDefs),
    employee_count: normalizeInteger(orgFromPayload?.employee_count ?? raw?.employee_count),
    annual_revenue: normalizeNumber(orgFromPayload?.annual_revenue ?? raw?.annual_revenue),
    formacion: resolveOrgTextField(orgFromPayload, raw?.[FORMACION_FIELD], FORMACION_FIELD, orgFieldDefs),
    servicio: resolveOrgTextField(orgFromPayload, raw?.[SERVICIO_FIELD], SERVICIO_FIELD, orgFieldDefs),
  };
}
