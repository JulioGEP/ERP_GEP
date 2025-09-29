import type { DealParticipant, DealSummary, TrainingProduct } from '../../types/deal';

type Json = any;

const rawApiBase = (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() || '';

function normalizeBase(base: string): string {
  if (!base) return '';
  return base.endsWith('/') ? base.replace(/\/+$/, '') : base;
}

const API_BASE = normalizeBase(rawApiBase) || '/.netlify/functions';

function joinUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

function withQuery(url: string, query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  if (!queryString) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  details?: unknown;

  constructor({ message, code, status, requestId, details }: { message: string; code: string; status: number; requestId?: string; details?: unknown }) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseTrainingProducts(value: unknown): TrainingProduct[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const quantity = toNumber((item as any)?.quantity);
    const code = (item as any)?.code ?? (item as any)?.product_code ?? null;
    const productId = (item as any)?.product_id ?? (item as any)?.id ?? null;
    return {
      product_id: toNumber(productId),
      name: typeof (item as any)?.name === 'string' ? (item as any).name : null,
      code: typeof code === 'string' ? code : code != null ? String(code) : null,
      quantity: quantity ?? 0
    };
  });
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .map((entry) => (entry == null ? null : typeof entry === 'string' ? entry : String(entry)))
    .filter((entry): entry is string => Boolean(entry?.trim()));
  return list.length ? list : undefined;
}

function toNullableStringArray(value: unknown): (string | null)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((entry) => {
    if (entry === null || entry === undefined) return null;
    return typeof entry === 'string' ? entry : String(entry);
  });
  return list.length ? list : undefined;
}

function parseParticipants(value: unknown): DealParticipant[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const participants = value
    .map((item) => {
      const participant = item as Record<string, unknown>;
      const personId = toNumber(participant.person_id ?? participant.id);
      const firstName =
        typeof participant.first_name === 'string'
          ? participant.first_name
          : typeof participant.firstName === 'string'
            ? participant.firstName
            : null;
      const lastName =
        typeof participant.last_name === 'string'
          ? participant.last_name
          : typeof participant.lastName === 'string'
            ? participant.lastName
            : null;
      const email =
        typeof participant.email === 'string'
          ? participant.email
          : typeof participant.person_email === 'string'
            ? participant.person_email
            : null;
      const phone =
        typeof participant.phone === 'string'
          ? participant.phone
          : typeof participant.person_phone === 'string'
            ? participant.person_phone
            : null;
      const role =
        typeof participant.role === 'string'
          ? participant.role
          : typeof participant.position === 'string'
            ? participant.position
            : null;

      if (personId || firstName || lastName || email || phone || role) {
        return {
          personId: personId ?? null,
          firstName,
          lastName,
          email,
          phone,
          role
        } satisfies DealParticipant;
      }
      return null;
    })
    .filter((participant): participant is DealParticipant => participant !== null);

  return participants.length ? participants : undefined;
}

function parseDealPayload(data: Json): DealSummary {
  const deal = data?.deal ?? data;
  if (!deal || typeof deal !== 'object') {
    throw new Error('La respuesta de la API no contiene información del presupuesto.');
  }

  const dealId = toNumber(deal.dealId ?? deal.deal_id ?? deal.id);
  if (!dealId) {
    throw new Error('La API no ha devuelto un identificador válido del presupuesto.');
  }

  const dealOrgId =
    toNumber(deal.dealOrgId ?? deal.deal_org_id ?? deal.org_id ?? deal.organizationId ?? deal.orgId) ?? 0;

  const organizationName =
    typeof deal.organizationName === 'string'
      ? deal.organizationName
      : typeof deal.organization_name === 'string'
        ? deal.organization_name
        : typeof deal.clientName === 'string'
          ? deal.clientName
          : typeof deal.client_name === 'string'
            ? deal.client_name
            : 'Organización sin nombre';

  const organizationCif =
    typeof deal.organizationCif === 'string'
      ? deal.organizationCif
      : typeof deal.organization_cif === 'string'
        ? deal.organization_cif
        : undefined;

  const organizationPhone =
    typeof deal.organizationPhone === 'string'
      ? deal.organizationPhone
      : typeof deal.organization_phone === 'string'
        ? deal.organization_phone
        : undefined;

  const organizationAddress =
    typeof deal.organizationAddress === 'string'
      ? deal.organizationAddress
      : typeof deal.organization_address === 'string'
        ? deal.organization_address
        : undefined;

  const trainingProducts = parseTrainingProducts(deal.training ?? deal.training_products);
  const trainingNames =
    toStringArray(deal.trainingNames) ??
    toStringArray(deal.training_names) ??
    (trainingProducts.length
      ? trainingProducts
          .map((product) => (product.name ?? '')?.toString().trim())
          .filter(Boolean) as string[]
      : undefined);

  const prodExtra = parseTrainingProducts(deal.prodExtra ?? deal.prod_extra);
  const prodExtraNames =
    toStringArray(deal.prodExtraNames) ??
    toStringArray(deal.prod_extra_names) ??
    (prodExtra.length
      ? prodExtra
          .map((product) => (product.name ?? '')?.toString().trim())
          .filter(Boolean) as string[]
      : undefined);

  const documents = toStringArray(deal.documents);
  const documentsIdRaw = Array.isArray(deal.documentsId)
    ? deal.documentsId
    : Array.isArray(deal.documents_id)
      ? deal.documents_id
      : undefined;
  const documentsId = documentsIdRaw
    ? documentsIdRaw
        .map((value) => toNumber(value))
        .filter((value): value is number => typeof value === 'number')
    : undefined;

  const notes = toStringArray(deal.notes);

  const documentsUrls = toNullableStringArray(deal.documentsUrls ?? deal.documents_urls);

  const participants = parseParticipants(deal.persons ?? deal.participants);

  const trainingType =
    typeof deal.trainingType === 'string'
      ? deal.trainingType
      : typeof deal.training_type === 'string'
        ? deal.training_type
        : undefined;

  const hours = toNumber(deal.hours ?? deal.hours_value);

  const dealDirection =
    typeof deal.deal_direction === 'string'
      ? deal.deal_direction
      : typeof deal.direction === 'string'
        ? deal.direction
        : undefined;

  const caes =
    typeof deal.caes === 'string'
      ? deal.caes
      : typeof deal.caes_code === 'string'
        ? deal.caes_code
        : undefined;

  const fundae =
    typeof deal.fundae === 'string'
      ? deal.fundae
      : typeof deal.fundae_code === 'string'
        ? deal.fundae_code
        : undefined;

  const hotelNight =
    typeof deal.hotelNight === 'string'
      ? deal.hotelNight
      : typeof deal.hotel_night === 'string'
        ? deal.hotel_night
        : undefined;

  const documentsNum =
    toNumber(deal.documentsNum ?? deal.documents_num) ?? (documents ? documents.length : undefined);

  const notesCount = toNumber(deal.notesCount ?? deal.notes_count) ?? (notes ? notes.length : undefined);

  const sede =
    typeof deal.sede === 'string'
      ? deal.sede
      : typeof deal.branch === 'string'
        ? deal.branch
        : '—';

  return {
    dealId,
    dealOrgId,
    organizationName,
    organizationCif,
    organizationPhone,
    organizationAddress,
    title: typeof deal.title === 'string' ? deal.title : `Presupuesto ${dealId}`,
    clientName:
      typeof deal.clientName === 'string'
        ? deal.clientName
        : typeof deal.client_name === 'string'
          ? deal.client_name
          : organizationName,
    sede,
    trainingNames,
    training: trainingProducts.length ? trainingProducts : undefined,
    trainingType,
    hours,
    dealDirection,
    caes,
    fundae,
    hotelNight,
    prodExtra: prodExtra.length ? prodExtra : undefined,
    prodExtraNames,
    documentsNum,
    documentsId,
    documents,
    documentsUrls,
    notesCount,
    notes,
    participants,
    createdAt:
      typeof deal.created_at === 'string'
        ? deal.created_at
        : typeof deal.createdAt === 'string'
          ? deal.createdAt
          : undefined,
    updatedAt:
      typeof deal.updated_at === 'string'
        ? deal.updated_at
        : typeof deal.updatedAt === 'string'
          ? deal.updatedAt
          : undefined
  };
}

async function parseJsonResponse(response: Response): Promise<Json> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Respuesta no es JSON: ${(error as Error).message}`);
  }
}

async function request(path: string, init?: RequestInit): Promise<Json> {
  const response = await fetch(joinUrl(path), init);
  const data = await parseJsonResponse(response);
  const apiBody = data && typeof data === 'object' ? data : null;

  const isError = !response.ok || apiBody?.ok === false;
  if (isError) {
    const code = typeof apiBody?.error_code === 'string' ? apiBody.error_code : `HTTP_${response.status}`;
    const message = typeof apiBody?.message === 'string' ? apiBody.message : `HTTP ${response.status}`;
    const status = !response.ok ? response.status : 400;
    throw new ApiError({
      message,
      code,
      status,
      requestId: typeof apiBody?.requestId === 'string' ? apiBody.requestId : undefined,
      details: apiBody ?? data
    });
  }

  return data;
}

export async function importPresupuesto(dealId: string): Promise<DealSummary> {
  const data = await request('/deals_import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dealId })
  });

  const payload = data?.deal ?? data;
  return parseDealPayload(payload);
}

export async function fetchDealsWithoutSessions(): Promise<DealSummary[]> {
  const data = await request(withQuery('/deals', { noSessions: true }), { method: 'GET' });
  const deals = Array.isArray(data?.deals) ? data.deals : Array.isArray(data) ? data : [];
  return deals.map((deal: Json) => parseDealPayload(deal));
}

export async function fetchDealDetail(dealId: number): Promise<DealSummary> {
  const data = await request(`/deals/${encodeURIComponent(dealId)}`, { method: 'GET' });
  const payload = data?.deal ?? data;
  return parseDealPayload(payload);
}

export const importDeal = importPresupuesto;
