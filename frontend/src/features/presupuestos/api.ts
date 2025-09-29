import type { DealSummary, TrainingProduct } from '../../types/deal';

type Json = any;

type Attempt = { url: string; error: string };

const rawApiBase = (import.meta as any)?.env?.VITE_API_BASE?.toString()?.trim() || '';

function normalizeBase(base: string): string {
  if (!base) return '';
  return base.endsWith('/') ? base.replace(/\/+$/, '') : base;
}

function isNetlifyFunctionsBase(base: string): boolean {
  return base.includes('.netlify/functions');
}

function getApiBases(): string[] {
  const base = normalizeBase(rawApiBase);
  if (base) {
    return [base];
  }
  return ['/api', '/.netlify/functions'];
}

const API_BASES = getApiBases();

function joinUrl(base: string, path: string): string {
  const normalizedBase = normalizeBase(base) || '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
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
    notesCount,
    notes,
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

function buildImportUrl(base: string): string {
  const path = isNetlifyFunctionsBase(base) ? '/deals_import' : '/deals/import';
  return joinUrl(base, path);
}

function buildDealsUrl(base: string): string {
  const path = isNetlifyFunctionsBase(base) ? '/deals' : '/deals';
  return withQuery(joinUrl(base, path), { noSessions: true });
}

function formatAttempts(attempts: Attempt[]): string {
  return attempts.map((attempt) => `${attempt.url} → ${attempt.error}`).join(' | ');
}

export async function importPresupuesto(dealId: string): Promise<DealSummary> {
  const attempts: Attempt[] = [];

  for (const base of API_BASES) {
    const url = buildImportUrl(base);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId })
      });

      const data = await parseJsonResponse(response);

      if (!response.ok) {
        const reason = (data && (data.error || data.message)) || `HTTP ${response.status}`;
        throw new Error(reason);
      }

      return parseDealPayload(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ url, error: message });
    }
  }

  throw new Error(`No se pudo importar el presupuesto. Intentos fallidos: ${formatAttempts(attempts)}`);
}

export async function fetchDealsWithoutSessions(): Promise<DealSummary[]> {
  const attempts: Attempt[] = [];

  for (const base of API_BASES) {
    const url = buildDealsUrl(base);
    try {
      const response = await fetch(url, { method: 'GET' });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        const reason = (data && (data.error || data.message)) || `HTTP ${response.status}`;
        throw new Error(reason);
      }

      const deals = Array.isArray(data?.deals) ? data.deals : Array.isArray(data) ? data : [];
      return deals.map((deal: Json) => parseDealPayload(deal));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ url, error: message });
    }
  }

  throw new Error(`No se pudo obtener el listado de presupuestos. Intentos fallidos: ${formatAttempts(attempts)}`);
}

export const importDeal = importPresupuesto;
