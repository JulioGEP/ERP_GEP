import { createHttpHandler } from './_shared/http';
import {
  findFieldDef,
  getDeal,
  getDealFields,
  getDealProducts,
  getOrganization,
  getPerson,
  optionLabelOf,
} from './_shared/pipedrive';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const HOLDED_CONTACTS_ENDPOINT = 'https://api.holded.com/api/invoicing/v1/contacts';
const HOLDED_ESTIMATES_ENDPOINT = 'https://api.holded.com/api/invoicing/v1/documents/estimate';
const PIPEDRIVE_HOLDED_FIELD_KEY = '4118257ffc3bad107769f69d05e5bd1d7415cadd';
const DEAL_SERVICE_TYPE_FIELD_KEYS = [
  'ce2c299bd19c48d40297cd7b204780585ab2a5f0',
  '1d78d202448ee549a86e0881ec06f3ff7842c5ea',
] as const;
const DEAL_ROUTE_SITE_FIELD_KEYS = [
  '21e21e35f209ba485a2e8a209e35eda396875d11',
  '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
] as const;
const DEAL_CONTACT_CODE_FIELD_KEY = '3f67c7125b2291a31a63dc01a778b6fd1ef41b3d';
const DEAL_PO_FIELD_KEY = '9cf8ccb7ef293494974f98ddbc72ec726486310e';
const DEAL_PAYMENT_DAY_FIELD_KEY = '2bbffae2c28ba11855fc1272ad70a31967bdb97c';
const DEAL_PAYMENT_FORM_FIELD_KEY = 'fccd44232ff07afb4014d6d32f8e94709afb24fe';
const DEAL_TRAINING_SITE_FIELD_KEY = '676d6bd51e52999c582c01f67c99a35ed30bf6ae';
const DEAL_TRAINING_DATE_FIELD_KEY = '98f072a788090ac2ae52017daaf9618c3a189033';
const DEAL_INVOICE_EMAIL_FIELD_KEY = '8b0652b56fd17d4547149f1ae26b1b74b527eaf0';
const DEAL_FUNDAE_FIELD_KEY = '245d60d4d18aec40ba888998ef92e5d00e494583';
const DEAL_CAES_FIELD_KEY = 'e1971bf3a21d48737b682bf8d864ddc5eb15a351';
const DEAL_BANK_ACCOUNT_FIELD_KEY = '18a96262c85016d68b9d4dd76c37768341928375';
const DEAL_EMPRESA_PIPELINE_ID = '1';
const DEAL_ABIERTA_PIPELINE_ID = '3';
const SERVICE_PIPELINE_LABELS = {
  gepServices: 'GEP Services',
  preventivos: 'Preventivos',
  pci: 'PCI',
} as const;
const DEAL_WON_STATUS = 'won';
const DEAL_EMPRESA_STAGE_NAME = 'Presupuesto aceptado';
const DEAL_ABIERTA_STAGE_NAME = 'Formación Ganada';
const DEAL_EMPRESA_EXCLUDED_TITLE_PREFIX = 'Contabilidad -';
const INDIVIDUAL_PAYMENT_METHOD_ID = '65845b74c9a83d8ce30d8b72';
const HOLDED_PAYMENT_METHOD_BY_PIPEDRIVE_FORM = [
  {
    pipedriveValue: 'TRF CAIXABANK ES42 2100 0297 0002 0048 7560',
    holdedId: '65845b74c9a83d8ce30d8b72',
  },
  {
    pipedriveValue: 'TRF BSANTANDER ES25 0049 2558 5127 1454 6449',
    holdedId: '65a4ea68deb80f770a03a605',
  },
  {
    pipedriveValue: 'CXB TPV WEB',
    holdedId: '6759892555d547e2c90aa0ae',
  },
  {
    pipedriveValue: 'TRF BSABADELL ES77 0081 0404 8500 0126 3131',
    holdedId: '65aa2fa043e2b80e3401df97',
  },
] as const;
const PAYMENT_METHOD_FALLBACKS = {
  sabadell: '65845b74c9a83d8ce30d8b72',
  madrid: '65a4ea68deb80f770a03a605',
  compraWeb: '6759892555d547e2c90aa0ae',
} as const;

type AbiertaRouteKey = 'andalucia' | 'madrid' | 'sabadell';
type EmpresaRouteKey =
  | 'andalucia'
  | 'andaluciaInCompany'
  | 'madrid'
  | 'madridInCompany'
  | 'sabadell'
  | 'sabadellInCompany'
  | 'nacional';
type RouteKey = AbiertaRouteKey | EmpresaRouteKey;
type BudgetKind = 'empresa' | 'individual';
type PipelineMode = 'abierta' | 'empresa' | 'services';
type ServicePipelineKey = keyof typeof SERVICE_PIPELINE_LABELS;
type ServiceTypeKey = 'bomberosPrivados' | 'pci' | 'pau' | 'productos' | 'cesion' | 'formacion';

type RouteConfig = {
  salesChannelId: string;
  tags: string[];
};

type ServiceRouteConfig = RouteConfig & {
  requiresRoute?: boolean;
};

const COMPANY_ROUTE_CONFIG: Record<AbiertaRouteKey, RouteConfig> = {
  andalucia: {
    salesChannelId: '65ba50c3f957de633000d5a0',
    tags: ['abierta', 'andalucianv', 'formacion'],
  },
  madrid: {
    salesChannelId: '65ba4fb510f428f465015381',
    tags: ['abierta', 'madridnv', 'formacion'],
  },
  sabadell: {
    salesChannelId: '65ba4be92a1064ab340301e2',
    tags: ['abierta', 'sabadellnv', 'formacion'],
  },
};

const INDIVIDUAL_ROUTE_CONFIG: Record<AbiertaRouteKey, RouteConfig> = {
  andalucia: {
    salesChannelId: '65ba50c3f957de633000d5a0',
    tags: ['abierta', 'formacion', 'cadiznv'],
  },
  madrid: {
    salesChannelId: '65ba4fb510f428f465015381',
    tags: ['abierta', 'formacion', 'madridnv'],
  },
  sabadell: {
    salesChannelId: '65ba4be92a1064ab340301e2',
    tags: ['abierta', 'formacion', 'sabadellnv'],
  },
};

const EMPRESA_ROUTE_CONFIG: Record<EmpresaRouteKey, RouteConfig> = {
  andalucia: {
    salesChannelId: '65ba50c3f957de633000d5a0',
    tags: ['grupo', 'andalucianv', 'formacion'],
  },
  andaluciaInCompany: {
    salesChannelId: '65ba5112e25378dc6a050f55',
    tags: ['grupo', 'andaluciaic', 'formacion'],
  },
  madrid: {
    salesChannelId: '65ba4fb510f428f465015381',
    tags: ['grupo', 'madridnv', 'formacion'],
  },
  madridInCompany: {
    salesChannelId: '65ba4ffe8efab3d86e091432',
    tags: ['grupo', 'madridic', 'formacion'],
  },
  sabadell: {
    salesChannelId: '65ba4be92a1064ab340301e2',
    tags: ['grupo', 'sabadellnv', 'formacion'],
  },
  sabadellInCompany: {
    salesChannelId: '65ba4c3005b3b1b8f60b5980',
    tags: ['grupo', 'sabadellic', 'formacion'],
  },
  nacional: {
    salesChannelId: '65ba4b65a47aee38e709cab8',
    tags: ['grupo', 'nacional', 'formacion'],
  },
};


const PREVENTIVOS_ROUTE_CONFIG: Record<Extract<EmpresaRouteKey, 'andaluciaInCompany' | 'madridInCompany' | 'sabadellInCompany'>, RouteConfig> = {
  andaluciaInCompany: {
    salesChannelId: '65ba51c32c9b6556a40410b2',
    tags: ['bomberosprivados', 'andaluciaic', 'preventivo'],
  },
  madridInCompany: {
    salesChannelId: '65ba5041fc50bcbf8f0b99dd',
    tags: ['bomberosprivados', 'madridic', 'preventivo'],
  },
  sabadellInCompany: {
    salesChannelId: '65ba4e99c9e3d9e7f80e5194',
    tags: ['bomberosprivados', 'sabadellic', 'preventivo'],
  },
};

const SERVICES_TYPE_CONFIG: Record<ServiceTypeKey, ServiceRouteConfig> = {
  bomberosPrivados: {
    salesChannelId: '',
    tags: [],
    requiresRoute: true,
  },
  pci: {
    salesChannelId: '65ba4efb2a6c0e434b0295c6',
    tags: ['pci'],
  },
  pau: {
    salesChannelId: '65aa4207fe2676bee4026949',
    tags: ['pau'],
  },
  productos: {
    salesChannelId: '65aa4207fe2676bee402b945',
    tags: ['productos'],
  },
  cesion: {
    salesChannelId: '65aa4208fe2676bee402b96b',
    tags: ['cesion'],
  },
  formacion: {
    salesChannelId: '65ba4c3005b3b1b8f60b5980',
    tags: ['formacion'],
  },
};

type HoldedContact = {
  id?: string | number;
  code?: string | null;
  name?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeText(item);
      if (normalized) return normalized;
    }
    return null;
  }
  if (typeof value === 'object') {
    const candidates = [
      (value as any).label,
      (value as any).name,
      (value as any).value,
      (value as any).formatted_address,
      (value as any).email,
      (value as any).phone,
      (value as any).id,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

function normalizeComparison(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function htmlToPlainText(value: unknown): string {
  const text = normalizeText(value) ?? '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>\s*<div>/gi, '\n')
    .replace(/<div>/gi, '')
    .replace(/<\/div>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = normalizeText(value);
  if (!normalized) return fallback;

  const compact = normalized.replace(/\s+/g, '').replace(/[^\d,.-]/g, '');
  if (!compact.length) return fallback;

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : null;

  let sanitized = compact;
  if (decimalSeparator === ',') {
    sanitized = sanitized.replace(/\./g, '').replace(',', '.');
  } else if (decimalSeparator === '.') {
    sanitized = sanitized.replace(/,/g, '');
  } else {
    sanitized = sanitized.replace(/[.,]/g, '');
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickPrimaryValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const primary = value.find((item) => item && typeof item === 'object' && (item as any).primary);
    return normalizeText(primary ?? value[0]);
  }
  return normalizeText(value);
}

function resolveFieldLabel(deal: Record<string, any>, fieldDefs: any[], fieldKeys: readonly string[]): string | null {
  for (const fieldKey of fieldKeys) {
    const fieldDef = findFieldDef(fieldDefs, fieldKey);
    const rawValue = deal?.[fieldKey];
    const labeled = fieldDef ? optionLabelOf(fieldDef, rawValue) : null;
    const normalized = normalizeText(labeled ?? rawValue);
    if (normalized) return normalized;
  }
  return null;
}

function resolveAddress(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const formatted = normalizeText((value as any).formatted_address);
    if (formatted) return formatted;
  }
  return normalizeText(value);
}

function resolveAbiertaRouteKey(routeLabel: string | null): AbiertaRouteKey | null {
  const normalized = normalizeComparison(routeLabel);
  if (!normalized) return null;
  if (normalized.includes('andaluc')) return 'andalucia';
  if (normalized.includes('madrid')) return 'madrid';
  if (normalized.includes('sabadell')) return 'sabadell';
  return null;
}

function resolveEmpresaRouteKey(routeLabel: string | null): EmpresaRouteKey | null {
  const normalized = normalizeComparison(routeLabel);
  if (!normalized) return null;
  if (normalized === 'nacional') return 'nacional';
  if (normalized.includes('andaluc') && normalized.includes('in company')) return 'andaluciaInCompany';
  if (normalized.includes('madrid') && normalized.includes('in company')) return 'madridInCompany';
  if (normalized.includes('sabadell') && normalized.includes('in company')) return 'sabadellInCompany';
  if (normalized.includes('andaluc')) return 'andalucia';
  if (normalized.includes('madrid')) return 'madrid';
  if (normalized.includes('sabadell')) return 'sabadell';
  return null;
}

function resolveBudgetKind(serviceTypeLabel: string | null): BudgetKind | null {
  const normalized = normalizeComparison(serviceTypeLabel);
  if (!normalized) return null;
  if (normalized.includes('empresa')) return 'empresa';
  if (normalized.includes('individual') || normalized.includes('autonomo')) return 'individual';
  return null;
}

function getAbiertaRouteConfig(kind: BudgetKind, routeKey: AbiertaRouteKey): RouteConfig {
  return kind === 'empresa' ? COMPANY_ROUTE_CONFIG[routeKey] : INDIVIDUAL_ROUTE_CONFIG[routeKey];
}

function getEmpresaRouteConfig(routeKey: EmpresaRouteKey): RouteConfig {
  return EMPRESA_ROUTE_CONFIG[routeKey];
}

function resolveServiceTypeKey(serviceTypeLabel: string | null): ServiceTypeKey | null {
  const normalized = normalizeComparison(serviceTypeLabel);
  if (!normalized) return null;
  if (normalized.includes('bomberos privados')) return 'bomberosPrivados';
  if (normalized === 'pci' || normalized.includes(' pci')) return 'pci';
  if (normalized.includes('pau')) return 'pau';
  if (normalized.includes('productos')) return 'productos';
  if (normalized.includes('cesion de material') || normalized.includes('cesion material')) return 'cesion';
  if (normalized.includes('formacion')) return 'formacion';
  return null;
}

function getPreventivosRouteConfig(routeKey: EmpresaRouteKey | null): RouteConfig | null {
  if (!routeKey) return null;
  if (routeKey === 'andaluciaInCompany' || routeKey === 'madridInCompany' || routeKey === 'sabadellInCompany') {
    return PREVENTIVOS_ROUTE_CONFIG[routeKey];
  }
  return null;
}

function resolveServicesRouteConfig(params: {
  pipelineKey: ServicePipelineKey;
  serviceTypeKey: ServiceTypeKey | null;
  routeKey: EmpresaRouteKey | null;
}): RouteConfig | null {
  if (params.pipelineKey === 'pci') {
    return SERVICES_TYPE_CONFIG.pci;
  }

  if (params.pipelineKey === 'preventivos') {
    return getPreventivosRouteConfig(params.routeKey);
  }

  if (params.serviceTypeKey === 'bomberosPrivados') {
    return getPreventivosRouteConfig(params.routeKey);
  }

  if (!params.serviceTypeKey) return null;

  const config = SERVICES_TYPE_CONFIG[params.serviceTypeKey];
  if (config.requiresRoute) {
    return getPreventivosRouteConfig(params.routeKey);
  }

  return config;
}

function findFieldDefByName(fieldDefs: any[], names: readonly string[]) {
  const normalizedNames = names.map((name) => normalizeComparison(name)).filter(Boolean);
  return (Array.isArray(fieldDefs) ? fieldDefs : []).find((fieldDef) => {
    const normalizedName = normalizeComparison(fieldDef?.name ?? fieldDef?.field_name);
    return normalizedName && normalizedNames.includes(normalizedName);
  });
}

function resolveFieldLabelByNames(deal: Record<string, any>, fieldDefs: any[], names: readonly string[]): string | null {
  const fieldDef = findFieldDefByName(fieldDefs, names);
  if (!fieldDef?.key) return null;
  const rawValue = deal?.[fieldDef.key];
  const labeled = optionLabelOf(fieldDef, rawValue);
  return normalizeText(labeled ?? rawValue);
}

function resolveHoldedPaymentMethodId(paymentForm: string | null): string | null {
  const normalizedPaymentForm = normalizeComparison(paymentForm);
  if (!normalizedPaymentForm) return null;

  const exactMatch = HOLDED_PAYMENT_METHOD_BY_PIPEDRIVE_FORM.find(
    (entry) => normalizeComparison(entry.pipedriveValue) === normalizedPaymentForm,
  );
  if (exactMatch) return exactMatch.holdedId;

  const partialMatch = HOLDED_PAYMENT_METHOD_BY_PIPEDRIVE_FORM.find((entry) =>
    normalizedPaymentForm.includes(normalizeComparison(entry.pipedriveValue)),
  );
  if (partialMatch) return partialMatch.holdedId;

  if (normalizedPaymentForm.includes('sabadell')) return PAYMENT_METHOD_FALLBACKS.sabadell;
  if (normalizedPaymentForm.includes('madrid') || normalizedPaymentForm.includes('santander')) {
    return PAYMENT_METHOD_FALLBACKS.madrid;
  }
  if (
    normalizedPaymentForm.includes('tpv')
    || normalizedPaymentForm.includes('web')
    || normalizedPaymentForm.includes('compra')
  ) {
    return PAYMENT_METHOD_FALLBACKS.compraWeb;
  }
  if (normalizedPaymentForm.includes('caixabank') || normalizedPaymentForm.includes('caixa bank')) {
    return INDIVIDUAL_PAYMENT_METHOD_ID;
  }

  return null;
}

function resolveHoldedPaymentMethodFallback(
  deal: Record<string, any>,
  fieldDefs: any[],
): string | null {
  const costCenter = resolveFieldLabelByNames(deal, fieldDefs, ['Centro de coste']);
  const normalizedCostCenter = normalizeComparison(costCenter);
  if (normalizedCostCenter.includes('sabadell')) {
    return PAYMENT_METHOD_FALLBACKS.sabadell;
  }
  if (normalizedCostCenter.includes('madrid')) {
    return PAYMENT_METHOD_FALLBACKS.madrid;
  }

  const purchaseChannel = resolveFieldLabelByNames(deal, fieldDefs, ['Canal Compra Deal']);
  const normalizedPurchaseChannel = normalizeComparison(purchaseChannel);
  if (normalizedPurchaseChannel.includes('compra web')) {
    return PAYMENT_METHOD_FALLBACKS.compraWeb;
  }

  return null;
}

function buildAbiertaBudgetNotes(params: {
  po: string | null;
  paymentDay: string | null;
  paymentForm: string | null;
  invoiceEmail: string | null;
  trainingSite: string | null;
  trainingDate: string | null;
  comercial: string | null;
}) {
  return [
    'Administración',
    `Orden de compra: ${params.po ?? ''}`,
    `Día de pago: ${params.paymentDay ?? ''}`,
    `Forma de Pago: ${params.paymentForm ?? ''}`,
    `Correo de Facturación: ${params.invoiceEmail ?? ''}`,
    '-----------',
    'Planificación',
    `Sede de la formación: ${params.trainingSite ?? ''}`,
    `Fecha Formación: ${params.trainingDate ?? ''}`,
    '-----------',
    `Comercial: ${params.comercial ?? ''}`,
  ].join('\n');
}

function buildEmpresaBudgetNotes(params: {
  po: string | null;
  paymentDay: string | null;
  paymentForm: string | null;
  invoiceEmail: string | null;
  trainingSite: string | null;
  fundae: string | null;
  caes: string | null;
  comercial: string | null;
}) {
  return [
    'Administración',
    `Orden de compra: ${params.po ?? ''}`,
    `Día de pago: ${params.paymentDay ?? ''}`,
    `Forma de Pago: ${params.paymentForm ?? ''}`,
    `Correo de Facturación: ${params.invoiceEmail ?? ''}`,
    '-----------',
    'Planificación',
    `Sede de la formación: ${params.trainingSite ?? ''}`,
    `FUNDAE: ${params.fundae ?? ''}`,
    `CAES: ${params.caes ?? ''}`,
    '-----------',
    `Comercial: ${params.comercial ?? ''}`,
  ].join('\n');
}

function buildItems(products: any[]): Array<Record<string, unknown>> {
  return (Array.isArray(products) ? products : []).map((product) => {
    const rawSku = normalizeText(product?.product_id ?? product?.id ?? product?.product?.id) ?? '';
    const name = normalizeText(product?.name ?? product?.product?.name) ?? 'Línea sin nombre';
    const description = htmlToPlainText(product?.comments ?? product?.description ?? '');
    const subtotal = parseNumber(product?.item_price ?? product?.price, 0);
    const tax = parseNumber(
      product?.product_tax ?? product?.tax ?? product?.product?.tax ?? product?.product?.tax_percentage,
      0,
    );
    const units = parseNumber(product?.quantity, 1) || 1;
    const discount = parseNumber(product?.discount ?? product?.discount_percentage, 0);

    return {
      sku: rawSku ? `SKU${rawSku}` : '',
      desc: description,
      subtotal,
      tax,
      units,
      discount,
      name,
    };
  });
}

function resolveServicePipelineKey(deal: Record<string, any>): ServicePipelineKey | null {
  const candidates = [deal?.pipeline_name, deal?.pipeline_label, deal?.pipeline_id]
    .map((value) => normalizeComparison(normalizeText(value)))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === normalizeComparison(SERVICE_PIPELINE_LABELS.gepServices)) return 'gepServices';
    if (candidate === normalizeComparison(SERVICE_PIPELINE_LABELS.preventivos)) return 'preventivos';
    if (candidate === normalizeComparison(SERVICE_PIPELINE_LABELS.pci)) return 'pci';
  }

  return null;
}

function resolvePipelineMode(deal: Record<string, any>): PipelineMode | null {
  const pipelineId = normalizeText(deal?.pipeline_id);
  if (pipelineId === DEAL_EMPRESA_PIPELINE_ID) return 'empresa';
  if (pipelineId === DEAL_ABIERTA_PIPELINE_ID) return 'abierta';

  if (resolveServicePipelineKey(deal)) return 'services';

  const pipelineLabel = normalizeText(deal?.pipeline_name ?? deal?.pipeline_label);
  const normalizedPipeline = normalizeComparison(pipelineLabel);
  if (normalizedPipeline.includes('formacion empresa')) return 'empresa';
  if (normalizedPipeline.includes('formacion abierta')) return 'abierta';

  return null;
}

async function holdedRequest<T = any>(
  apiKey: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      key: apiKey,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text().catch(() => '');
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!response.ok) {
    const serialized = typeof json === 'string' ? json : JSON.stringify(json ?? {});
    throw new Error(`Holded respondió ${response.status}: ${serialized}`);
  }

  return json as T;
}

async function findOrCreateHoldedContact(params: {
  apiKey: string;
  code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  currency: string | null;
  individual: boolean;
}) {
  const searchTerms = [params.code, params.name].filter((value): value is string => Boolean(value));
  for (const searchTerm of searchTerms) {
    const url = `${HOLDED_CONTACTS_ENDPOINT}?search=${encodeURIComponent(searchTerm)}`;
    const results = await holdedRequest<HoldedContact[]>(params.apiKey, url, { method: 'GET' }).catch(() => []);
    const normalizedSearch = normalizeComparison(searchTerm);
    const matched = Array.isArray(results)
      ? results.find((contact) => {
          const codeMatches = normalizeComparison(contact?.code) === normalizedSearch;
          const nameMatches = normalizeComparison(contact?.name) === normalizeComparison(params.name);
          return codeMatches || nameMatches;
        })
      : null;

    if (matched?.id != null) {
      return {
        id: String(matched.id),
        code: normalizeText(matched.code) ?? params.code ?? '',
        created: false,
      };
    }
  }

  const payload = {
    code: params.code ?? undefined,
    type: 'client',
    isperson: 'Company',
    phone: params.phone ?? undefined,
    address: params.address ?? undefined,
    tags: params.individual ? ['abiertaindividual'] : [],
    name: params.name,
    currency: params.currency ?? undefined,
  };

  const created = await holdedRequest<any>(params.apiKey, HOLDED_CONTACTS_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const createdId = normalizeText(created?.id ?? created?._id);
  if (!createdId) {
    throw new Error('Holded no devolvió el identificador del contacto creado.');
  }

  return {
    id: createdId,
    code: normalizeText(created?.code) ?? params.code ?? '',
    created: true,
  };
}

async function updatePipedriveHoldedField(dealId: string, holdedDocumentId: string) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error('Falta PIPEDRIVE_API_TOKEN en variables de entorno');
  }

  const baseUrl = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
  const url = `${baseUrl.replace(/\/$/, '')}/deals/${encodeURIComponent(dealId)}?api_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ [PIPEDRIVE_HOLDED_FIELD_KEY]: holdedDocumentId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`No se pudo actualizar Pipedrive (${response.status}): ${text}`);
  }
}

export const handler = createHttpHandler<{ dealId?: string }>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const dealId = normalizeText(request.body?.dealId);
  if (!dealId) {
    return errorResponse('VALIDATION_ERROR', 'Falta dealId para enviar el presupuesto a Holded.', 400);
  }

  const holdedApiKey = process.env.API_HOLDED_KEY;
  if (!holdedApiKey) {
    return errorResponse('CONFIG_ERROR', 'API_HOLDED_KEY no configurada.', 500);
  }

  try {
    const [deal, fieldDefs, products] = await Promise.all([
      getDeal(dealId),
      getDealFields(),
      getDealProducts(dealId),
    ]);

    if (!deal) {
      return errorResponse('NOT_FOUND', 'No se encontró el deal en Pipedrive.', 404);
    }

    const status = normalizeComparison(deal?.status);
    const stageName = normalizeText(deal?.stage_name ?? deal?.stage?.name);
    const pipelineMode = resolvePipelineMode(deal);
    const existingHoldedId = normalizeText(deal?.[PIPEDRIVE_HOLDED_FIELD_KEY]);

    if (existingHoldedId) {
      return errorResponse('ALREADY_SYNCED', 'El presupuesto ya tiene un ID de Holded asociado.', 409);
    }

    if (!pipelineMode) {
      return errorResponse(
        'INVALID_PIPELINE',
        'El deal no pertenece a un pipeline compatible con el envío a Holded.',
        400,
      );
    }

    if (status && status !== normalizeComparison(DEAL_WON_STATUS)) {
      return errorResponse('INVALID_STATUS', 'Solo se pueden enviar a Holded deals ganados.', 400);
    }

    const expectedStageName = pipelineMode === 'abierta' ? DEAL_ABIERTA_STAGE_NAME : DEAL_EMPRESA_STAGE_NAME;
    if (stageName && normalizeComparison(stageName) !== normalizeComparison(expectedStageName)) {
      return errorResponse('INVALID_STAGE', `El deal debe estar en la fase ${expectedStageName}.`, 400);
    }

    const title = normalizeText(deal?.title);
    if (
      (pipelineMode === 'empresa' || pipelineMode === 'services')
      && title
      && normalizeComparison(title).startsWith(normalizeComparison(DEAL_EMPRESA_EXCLUDED_TITLE_PREFIX))
    ) {
      return errorResponse(
        'UNSUPPORTED_DEAL',
        'Los presupuestos de contabilidad no se envían a Holded desde esta acción.',
        400,
      );
    }

    const routeLabel = resolveFieldLabel(deal, fieldDefs, DEAL_ROUTE_SITE_FIELD_KEYS);
    const serviceTypeLabel = resolveFieldLabel(deal, fieldDefs, DEAL_SERVICE_TYPE_FIELD_KEYS);
    const servicePipelineKey = pipelineMode === 'services' ? resolveServicePipelineKey(deal) : null;
    const serviceTypeKey = pipelineMode === 'services' ? resolveServiceTypeKey(serviceTypeLabel) : null;

    const routeKey = pipelineMode === 'empresa'
      ? resolveEmpresaRouteKey(routeLabel)
      : pipelineMode === 'abierta'
        ? resolveAbiertaRouteKey(routeLabel)
        : resolveEmpresaRouteKey(routeLabel);

    if (pipelineMode !== 'services' && !routeKey) {
      return errorResponse('UNSUPPORTED_SITE', 'La sede del presupuesto no está contemplada en la automatización.', 400);
    }

    const budgetKind = pipelineMode === 'empresa' || pipelineMode === 'services'
      ? 'empresa'
      : resolveBudgetKind(serviceTypeLabel);
    if (!budgetKind) {
      return errorResponse('UNSUPPORTED_SERVICE_TYPE', 'El tipo de servicio no está contemplado en la automatización.', 400);
    }

    const [organization, person] = await Promise.all([
      deal?.org_id ? getOrganization((deal.org_id as any)?.value ?? deal.org_id) : null,
      deal?.person_id ? getPerson((deal.person_id as any)?.value ?? deal.person_id) : null,
    ]);

    const organizationName = normalizeText(organization?.name) ?? normalizeText((deal.org_id as any)?.name);
    const personName = [normalizeText(person?.first_name ?? person?.name), normalizeText(person?.last_name)]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .trim();
    const contactName = organizationName ?? personName ?? `Deal ${dealId}`;
    const routeConfig = pipelineMode === 'empresa'
      ? getEmpresaRouteConfig(routeKey as EmpresaRouteKey)
      : pipelineMode === 'abierta'
        ? getAbiertaRouteConfig(budgetKind, routeKey as AbiertaRouteKey)
        : resolveServicesRouteConfig({
            pipelineKey: servicePipelineKey!,
            serviceTypeKey,
            routeKey: routeKey as EmpresaRouteKey | null,
          });

    if (!routeConfig) {
      const code = routeKey ? 'UNSUPPORTED_SERVICE_TYPE' : 'UNSUPPORTED_SITE';
      const message = routeKey
        ? 'La combinación de tipo de servicio y sede no está contemplada en la automatización.'
        : 'La sede del presupuesto no está contemplada en la automatización.';
      return errorResponse(code, message, 400);
    }

    const contactCode = normalizeText(deal?.[DEAL_CONTACT_CODE_FIELD_KEY]);
    const contactPhone = pickPrimaryValue(person?.phone ?? (deal.person_id as any)?.phone);
    const contactAddress = resolveAddress(organization?.address ?? (deal.org_id as any)?.address);
    const currency = normalizeText(deal?.currency);

    const holdedContact = await findOrCreateHoldedContact({
      apiKey: holdedApiKey,
      code: contactCode,
      name: contactName,
      phone: contactPhone,
      address: contactAddress,
      currency,
      individual: budgetKind === 'individual',
    });

    const paymentFormLabel = resolveFieldLabel(deal, fieldDefs, [DEAL_PAYMENT_FORM_FIELD_KEY])
      ?? normalizeText(deal?.[DEAL_PAYMENT_FORM_FIELD_KEY]);
    const bankAccountLabel = resolveFieldLabel(deal, fieldDefs, [DEAL_BANK_ACCOUNT_FIELD_KEY])
      ?? normalizeText(deal?.[DEAL_BANK_ACCOUNT_FIELD_KEY]);
    const holdedPaymentMethodId = resolveHoldedPaymentMethodId(
      pipelineMode === 'empresa' || pipelineMode === 'services' ? bankAccountLabel ?? paymentFormLabel : paymentFormLabel,
    ) ?? resolveHoldedPaymentMethodFallback(deal, fieldDefs);

    const notes = pipelineMode === 'empresa' || pipelineMode === 'services'
      ? buildEmpresaBudgetNotes({
          po: normalizeText(deal?.[DEAL_PO_FIELD_KEY]),
          paymentDay: normalizeText(deal?.[DEAL_PAYMENT_DAY_FIELD_KEY]),
          paymentForm: paymentFormLabel,
          invoiceEmail: normalizeText(deal?.[DEAL_INVOICE_EMAIL_FIELD_KEY]),
          trainingSite: resolveFieldLabel(deal, fieldDefs, [DEAL_TRAINING_SITE_FIELD_KEY]),
          fundae:
            resolveFieldLabel(deal, fieldDefs, [DEAL_FUNDAE_FIELD_KEY]) ?? normalizeText(deal?.[DEAL_FUNDAE_FIELD_KEY]),
          caes:
            resolveFieldLabel(deal, fieldDefs, [DEAL_CAES_FIELD_KEY]) ?? normalizeText(deal?.[DEAL_CAES_FIELD_KEY]),
          comercial: normalizeText(deal?.owner_name ?? deal?.owner_id?.name),
        })
      : buildAbiertaBudgetNotes({
          po: normalizeText(deal?.[DEAL_PO_FIELD_KEY]),
          paymentDay: normalizeText(deal?.[DEAL_PAYMENT_DAY_FIELD_KEY]),
          paymentForm: paymentFormLabel,
          invoiceEmail: normalizeText(deal?.[DEAL_INVOICE_EMAIL_FIELD_KEY]),
          trainingSite: resolveFieldLabel(deal, fieldDefs, [DEAL_TRAINING_SITE_FIELD_KEY]),
          trainingDate: normalizeText(deal?.[DEAL_TRAINING_DATE_FIELD_KEY]),
          comercial: normalizeText(deal?.owner_name ?? deal?.owner_id?.name),
        });

    const items = buildItems(Array.isArray(products) ? products : []);
    if (!items.length) {
      return errorResponse('NO_PRODUCTS', 'El deal no tiene líneas de producto para enviar a Holded.', 400);
    }

    const quotePayload: Record<string, unknown> = {
      date: normalizeText(deal?.update_time ?? deal?.add_time),
      contactCode: holdedContact.code || undefined,
      contactId: holdedContact.id,
      invoiceNum: `PRVGR25-${dealId}`,
      salesChannelId: routeConfig.salesChannelId,
      tags: routeConfig.tags,
      notes,
      items,
    };

    if (holdedPaymentMethodId) {
      quotePayload.paymentMethod = holdedPaymentMethodId;
    } else if (budgetKind === 'individual') {
      quotePayload.paymentMethod = INDIVIDUAL_PAYMENT_METHOD_ID;
    }

    const createdQuote = await holdedRequest<any>(holdedApiKey, HOLDED_ESTIMATES_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(quotePayload),
    });

    const documentId = normalizeText(createdQuote?.id);
    if (!documentId) {
      throw new Error('Holded no devolvió el identificador del presupuesto creado.');
    }

    await Promise.all([
      updatePipedriveHoldedField(dealId, documentId),
      getPrisma().deals.updateMany({
        where: { deal_id: dealId },
        data: { presu_holded: documentId },
      }),
    ]);

    return successResponse({
      documentId,
      holdedContactId: holdedContact.id,
      holdedContactCode: holdedContact.code,
      budgetKind,
      routeKey: routeKey ?? undefined,
      pipelineMode,
      simulated: true,
    });
  } catch (error) {
    console.error('[budgets-send-to-holded] sync failed', { dealId, error });
    const message = error instanceof Error ? error.message : 'No se pudo enviar el presupuesto a Holded.';
    return errorResponse('HOLDED_SYNC_ERROR', message, 500);
  }
});
