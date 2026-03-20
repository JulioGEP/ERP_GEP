import type { PrismaClient } from '@prisma/client';

import { getDealNotes, getDealProducts } from './pipedrive';

type JsonObject = Record<string, unknown>;

type MetaEntry = {
  key: string;
  value: unknown;
};

type Student = {
  firstName: string | null;
  lastName: string | null;
  dni: string | null;
};

type NormalizedWooOrder = {
  orderId: string;
  orderNumber: string;
  status: string | null;
  companyName: string | null;
  billingFirstName: string | null;
  billingLastName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  billingCif: string | null;
  trafficSource: string | null;
  productName: string | null;
  productIdWoo: string | null;
  variationIdWoo: string | null;
  sku: string | null;
  quantity: number;
  subtotal: number;
  rawDate: string | null;
  rawLocation: string | null;
  formattedDate: string | null;
  formattedLocation: string | null;
  fundae: string | null;
  requiresPurchaseOrder: string | null;
  printScan: string | null;
  observations: string | null;
  couponCodes: string[];
  students: Student[];
};

type PipedriveSyncResult = {
  organizationId: string;
  personId: string;
  dealId: string;
  presupuesto: string | null;
  organizationCreated: boolean;
  personCreated: boolean;
  dealCreated: boolean;
  productAdded: boolean;
  notesCreated: string[];
  warnings: string[];
};

type ProductResolution = {
  idPipe: string | null;
  productName: string | null;
};

type DealSingleOptionValues = {
  trainingOptionId: string | null;
  siteOptionId: string | null;
  fundaeOptionId: string | null;
  trainingLookupLabel: string | null;
  siteLookupLabel: string | null;
  fundaeLookupLabel: string | null;
};

type FieldOptionLookupParams = {
  fieldKey: string;
  fieldName: string;
  candidateLabels: Array<string | null | undefined>;
};

const DEFAULT_ORG_OWNER_ID = parseIntegerEnv(process.env.WOOCOMMERCE_PIPE_DEFAULT_OWNER_ID, 13444807);
const DEFAULT_PIPELINE_ID = parseIntegerEnv(process.env.WOOCOMMERCE_PIPE_PIPELINE_ID, 3);
const DEFAULT_OPEN_STAGE_ID = parseIntegerEnv(process.env.WOOCOMMERCE_PIPE_OPEN_STAGE_ID, 13);
const DEFAULT_WON_STAGE_ID = parseIntegerEnv(process.env.WOOCOMMERCE_PIPE_WON_STAGE_ID, 18);
const DEFAULT_VISIBLE_TO = parseIntegerEnv(process.env.WOOCOMMERCE_PIPE_VISIBLE_TO, 7);

const ORG_CIF_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_ORG_CIF_FIELD_KEY || '6d39d015a33921753410c1bab0b067ca93b8cf2c';
const ORG_PHONE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_ORG_PHONE_FIELD_KEY || 'b4379db06dfbe0758d84c2c2dd45ef04fa093b6d';
const ORG_EMAIL_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_ORG_EMAIL_FIELD_KEY || '304ab03c5ac339ef085f0f6cfe4cb1c89ed6aa9f';
const ORG_TRAFFIC_SOURCE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_ORG_TRAFFIC_SOURCE_FIELD_KEY || '0fc89035ac2e1b484953c6733a81e6693047d1ec';

const PERSON_CIF_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_PERSON_CIF_FIELD_KEY || 'b468b281ef6398b05a2348ad529c56267694a543';
const PERSON_ADDRESS_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_PERSON_ADDRESS_FIELD_KEY || 'cfc59f9181a6a9558a71a9630d5d0088392b1a25';
const PERSON_TRAFFIC_SOURCE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_PERSON_TRAFFIC_SOURCE_FIELD_KEY || 'adc9b64ef6039268a964a24b402f72b67316a49d';

const DEAL_WC_ORDER_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_WC_ORDER_FIELD_KEY || '9cf8ccb7ef293494974f98ddbc72ec726486310e';
const DEAL_TRAFFIC_SOURCE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_TRAFFIC_SOURCE_FIELD_KEY || 'abfa216589d01466453514fdcfeb1c6e5b9fdf8d';
const DEAL_SOURCE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_SOURCE_FIELD_KEY || 'c6eabce7c04f864646aa72c944f875fd71cdf178';
const DEAL_SERVICE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_SERVICE_FIELD_KEY || 'e72120b9e27221b560c8480ff422f3fe28f8dbae';
const DEAL_TRAINING_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_TRAINING_FIELD_KEY || 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab';
const DEAL_SITE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_SITE_FIELD_KEY || '676d6bd51e52999c582c01f67c99a35ed30bf6ae';
const DEAL_STUDENTS_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_STUDENTS_FIELD_KEY || '6cfa536f9a54a07f849c1eba52a9b3f8d1f411f5';
const DEAL_FUNDAE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_FUNDAE_FIELD_KEY || '245d60d4d18aec40ba888998ef92e5d00e494583';
const DEAL_SKU_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_SKU_FIELD_KEY || 'f4de9f2397db874ed587cf324055caef89a7934c';
const DEAL_VARIATION_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_VARIATION_FIELD_KEY || '478b2a7f79323212032ab2344aff193c4bf77523';
const DEAL_TRAINING_DATE_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_TRAINING_DATE_FIELD_KEY || '98f072a788090ac2ae52017daaf9618c3a189033';
const DEAL_CONSTANT_STATUS_FIELD_KEY = process.env.WOOCOMMERCE_PIPE_DEAL_CONSTANT_STATUS_FIELD_KEY || 'ce2c299bd19c48d40297cd7b204780585ab2a5f0';

const DEAL_INITIAL_SERVICE_VALUE = process.env.WOOCOMMERCE_PIPE_DEAL_INITIAL_SERVICE_VALUE || '234';
const DEAL_WON_SERVICE_VALUE = process.env.WOOCOMMERCE_PIPE_DEAL_WON_SERVICE_VALUE || '236';
const DEAL_INITIAL_SOURCE_VALUE = process.env.WOOCOMMERCE_PIPE_DEAL_INITIAL_SOURCE_VALUE || 'reserva web';
const DEAL_CONSTANT_STATUS_VALUE = process.env.WOOCOMMERCE_PIPE_DEAL_CONSTANT_STATUS_VALUE || '63';

function parseIntegerEnv(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized.length) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeBooleanText(value: string | null): 'yes' | 'no' | null {
  if (!value) return null;
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (['yes', 'si', 'sí', 'true', '1'].includes(normalized)) return 'yes';
  if (['no', 'false', '0'].includes(normalized)) return 'no';
  return null;
}

function readObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function joinNonEmpty(parts: Array<string | null>, separator = ' '): string | null {
  const normalized = parts.map((part) => (part ?? '').trim()).filter((part) => part.length > 0);
  return normalized.length ? normalized.join(separator) : null;
}

function normalizeMetaEntries(value: unknown): MetaEntry[] {
  const items: MetaEntry[] = [];
  for (const entry of readArray(value)) {
    const record = readObject(entry);
    if (!record) continue;
    const key = readString(record.key ?? record.name);
    if (!key) continue;
    items.push({
      key,
      value: record.value ?? null,
    });
  }
  return items;
}

function normalizeMetaKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^_+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}

function pickMetaValue(meta: MetaEntry[], aliases: string[]): string | null {
  const normalizedAliases = aliases.map(normalizeMetaKey);
  for (const entry of meta) {
    const normalizedKey = normalizeMetaKey(entry.key);
    if (normalizedAliases.includes(normalizedKey)) {
      if (Array.isArray(entry.value)) {
        const values = entry.value.map(readString).filter((item): item is string => Boolean(item));
        return values.length ? values.join(', ') : null;
      }
      return readString(entry.value);
    }
  }
  return null;
}

function normalizeCouponCodes(payload: JsonObject): string[] {
  return readArray(payload.coupon_lines)
    .map((entry) => readObject(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .map((entry) => readString(entry.code))
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.trim().toLowerCase());
}

function splitCompositeValue(value: string | null): string | null {
  if (!value) return null;
  const [firstChunk] = value.split('-ca');
  const normalized = firstChunk.trim();
  return normalized.length ? normalized : value;
}

function formatTrainingDate(value: string | null): string | null {
  const normalized = splitCompositeValue(value);
  if (!normalized) return null;

  const ddmmyyyyMatch = normalized.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, dd, mm, yyyy] = ddmmyyyyMatch;
    return `${yyyy}-${mm}-${dd}T08:00:00`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toISOString().slice(0, 19);
}

function resolvePayload(body: JsonObject): JsonObject {
  const candidates = [body.order, body.data, body.payload];
  for (const candidate of candidates) {
    const record = readObject(candidate);
    if (record && (record.id !== undefined || record.number !== undefined || record.status !== undefined)) {
      return record;
    }
  }
  return body;
}

function extractStudents(orderMeta: MetaEntry[]): Student[] {
  const students: Student[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const firstName = pickMetaValue(orderMeta, [`cstm_full_name${index}`, `custom_full_name${index}`]);
    const lastName = pickMetaValue(orderMeta, [`cstm_apellidos${index}`, `custom_apellidos${index}`]);
    const dni = pickMetaValue(orderMeta, [`cstm_dni${index}`, `custom_dni${index}`]);
    if (firstName || lastName || dni) {
      students.push({ firstName, lastName, dni });
    }
  }
  return students;
}

function normalizeWooOrder(payloadRoot: JsonObject): NormalizedWooOrder {
  const payload = resolvePayload(payloadRoot);
  const billing = readObject(payload.billing);
  const lineItem = readArray(payload.line_items)
    .map((entry) => readObject(entry))
    .find((entry): entry is JsonObject => entry !== null) ?? {};
  const orderMeta = normalizeMetaEntries(payload.meta_data);
  const lineMeta = normalizeMetaEntries(lineItem.meta_data);

  const orderId = readString(payload.id) ?? readString(payloadRoot.order_id) ?? '';
  const orderNumber =
    readString(payload.number) ?? readString(payload.order_number) ?? readString(payloadRoot.order_number) ?? orderId;

  const companyName =
    readString(billing?.company) ??
    pickMetaValue(orderMeta, ['billing_company', 'company']) ??
    joinNonEmpty([readString(billing?.first_name), readString(billing?.last_name)]);

  const rawDate =
    pickMetaValue(lineMeta, ['pa_fechas', 'meta_data_pa_fechas', 'attribute_pa_fechas']) ??
    readString(lineItem['meta_data_pa_fechas']);
  const rawLocation =
    pickMetaValue(lineMeta, ['pa_localizacion', 'meta_data_pa_localizacion', 'attribute_pa_localizacion']) ??
    readString(lineItem['meta_data_pa_localizacion']);

  return {
    orderId,
    orderNumber,
    status: readString(payload.status),
    companyName,
    billingFirstName: readString(billing?.first_name),
    billingLastName: readString(billing?.last_name),
    billingEmail: readString(billing?.email),
    billingPhone: readString(billing?.phone),
    billingAddress: readString(billing?.address_1),
    billingCity: readString(billing?.city),
    billingPostcode: readString(billing?.postcode),
    billingCountry: readString(billing?.country),
    billingCif: pickMetaValue(orderMeta, ['billing_cif', 'meta_data_billing_cif', 'nif_cif', 'cif']),
    trafficSource: pickMetaValue(orderMeta, ['traffic_source', 'meta_data_traffic_source', 'utm_source']),
    productName:
      readString(lineItem.parent_name) ?? readString(lineItem.name) ?? pickMetaValue(lineMeta, ['parent_name']),
    productIdWoo: readString(lineItem.product_id),
    variationIdWoo: readString(lineItem.variation_id),
    sku: readString(lineItem.sku),
    quantity: Math.max(1, Math.trunc(readNumber(lineItem.quantity) ?? 1)),
    subtotal: readNumber(lineItem.subtotal) ?? readNumber(payload.total) ?? 0,
    rawDate,
    rawLocation,
    formattedDate: formatTrainingDate(rawDate),
    formattedLocation: splitCompositeValue(rawLocation),
    fundae: pickMetaValue(orderMeta, ['custom_fundae', 'meta_data_custom_fundae', 'fundae']),
    requiresPurchaseOrder: pickMetaValue(orderMeta, ['custom_order', 'meta_data_custom_order', 'purchase_order']),
    printScan: pickMetaValue(orderMeta, ['custom_print_scan', 'meta_data_custom_print_scan', 'print_scan']),
    observations: pickMetaValue(orderMeta, ['custom_observations', 'meta_data_custom_observations', 'observations']),
    couponCodes: normalizeCouponCodes(payload),
    students: extractStudents(orderMeta),
  };
}

function buildAddress(order: NormalizedWooOrder): string | null {
  return joinNonEmpty(
    [order.billingAddress, order.billingCity, order.billingPostcode, order.billingCountry],
    ' , ',
  );
}

function buildDealTitle(order: NormalizedWooOrder): string {
  return `WC- ${order.companyName ?? 'Sin empresa'} - ${order.orderNumber}`;
}

function classifyOrder(order: NormalizedWooOrder): {
  type: 'cliente' | 'partner';
  discountPercentage: number;
  requiresPrintScan: boolean;
  requiresFundae: boolean;
  requiresPurchaseOrder: boolean;
} {
  const coupons = order.couponCodes;
  const isPartner = coupons.some((coupon) => coupon.includes('partner100'));
  const isClient20 = coupons.some((coupon) => coupon.includes('cliente100dto20'));
  const requiresPrintScan = normalizeBooleanText(order.printScan) === 'yes';
  const requiresFundae = normalizeBooleanText(order.fundae) === 'yes';
  const requiresPurchaseOrder = normalizeBooleanText(order.requiresPurchaseOrder) === 'yes';

  let discountPercentage = 0;
  if (isPartner) {
    discountPercentage = requiresPrintScan ? 15 : 20;
  } else if (isClient20) {
    discountPercentage = 20;
  }

  return {
    type: isPartner ? 'partner' : 'cliente',
    discountPercentage,
    requiresPrintScan,
    requiresFundae,
    requiresPurchaseOrder,
  };
}

function toBigIntOrNull(value: string | null): bigint | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function toIntegerIdOrNull(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function resolveProduct(prisma: PrismaClient, order: NormalizedWooOrder): Promise<ProductResolution> {
  const variationId = toBigIntOrNull(order.variationIdWoo);
  if (variationId !== null) {
    const variant = await prisma.variants.findFirst({
      where: { id_woo: variationId },
      select: { products: { select: { id_pipe: true, name: true } } },
    });
    if (variant?.products?.id_pipe) {
      return { idPipe: variant.products.id_pipe, productName: variant.products.name ?? order.productName };
    }
  }

  const productWooId = toBigIntOrNull(order.productIdWoo);
  if (productWooId !== null) {
    const product = await prisma.products.findFirst({
      where: { id_woo: productWooId },
      select: { id_pipe: true, name: true },
    });
    if (product?.id_pipe) {
      return { idPipe: product.id_pipe, productName: product.name ?? order.productName };
    }
  }

  if (order.productName) {
    const product = await prisma.products.findFirst({
      where: { name: { equals: order.productName, mode: 'insensitive' } },
      select: { id_pipe: true, name: true },
    });
    if (product?.id_pipe) {
      return { idPipe: product.id_pipe, productName: product.name ?? order.productName };
    }
  }

  return { idPipe: null, productName: order.productName };
}

function normalizeLookupLabel(value: string | null): string | null {
  if (!value) return null;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function resolveSingleOptionId(
  prisma: PrismaClient,
  params: FieldOptionLookupParams,
): Promise<{ optionId: string | null; matchedLabel: string | null }> {
  const normalizedCandidates = params.candidateLabels
    .map((candidate) => readString(candidate))
    .map((candidate) => normalizeLookupLabel(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  if (!normalizedCandidates.length) {
    return { optionId: null, matchedLabel: null };
  }

  const options = await prisma.pipedrive_custom_field_options.findMany({
    where: {
      OR: [
        { field_key: params.fieldKey },
        { field_name: { equals: params.fieldName, mode: 'insensitive' } },
      ],
    },
    select: { option_id: true, option_label: true },
    orderBy: [{ option_order: 'asc' }, { option_label: 'asc' }],
  });

  const match = options.find((option) => {
    const normalizedOptionLabel = normalizeLookupLabel(option.option_label);
    return normalizedOptionLabel ? normalizedCandidates.includes(normalizedOptionLabel) : false;
  });

  return {
    optionId: match?.option_id ?? null,
    matchedLabel: match?.option_label ?? null,
  };
}

async function resolveDealSingleOptionValues(
  prisma: PrismaClient,
  order: NormalizedWooOrder,
): Promise<DealSingleOptionValues> {
  const trainingLookupLabel = order.productName;
  const siteLookupLabel = order.formattedLocation ?? order.rawLocation;
  const fundaeLookupLabel = normalizeBooleanText(order.fundae) === 'yes' ? 'Sí' : normalizeBooleanText(order.fundae) === 'no' ? 'No' : order.fundae;

  const [trainingOption, siteOption, fundaeOption] = await Promise.all([
    resolveSingleOptionId(prisma, {
      fieldKey: DEAL_TRAINING_FIELD_KEY,
      fieldName: 'Formación',
      candidateLabels: [trainingLookupLabel],
    }),
    resolveSingleOptionId(prisma, {
      fieldKey: DEAL_SITE_FIELD_KEY,
      fieldName: 'Sede de la Formación',
      candidateLabels: [siteLookupLabel, order.rawLocation],
    }),
    resolveSingleOptionId(prisma, {
      fieldKey: DEAL_FUNDAE_FIELD_KEY,
      fieldName: 'FUNDAE',
      candidateLabels: [fundaeLookupLabel, order.fundae],
    }),
  ]);

  return {
    trainingOptionId: trainingOption.optionId,
    siteOptionId: siteOption.optionId,
    fundaeOptionId: fundaeOption.optionId,
    trainingLookupLabel,
    siteLookupLabel,
    fundaeLookupLabel,
  };
}

function buildStudentsNote(order: NormalizedWooOrder): string {
  if (!order.students.length) {
    return '"Alumnos del Deal"\nSin alumnos informados desde WooCommerce.';
  }

  const students = order.students
    .map((student) => `${student.firstName ?? '—'} | ${student.lastName ?? '—'} | ${student.dni ?? '—'}`)
    .join(' ; ');

  return `"Alumnos del Deal"\n${students} ;`;
}

function buildDetailsNote(order: NormalizedWooOrder): string {
  return [
    '“Detalles del documentación”',
    `- ¿Vas a gestionar FUNDAE?: ${order.fundae ?? '—'}`,
    `- ¿Tenemos que escanear la información?: ${order.printScan ?? '—'}`,
    `- ¿Es necesario que nos envíe una orden de compra antes de generar la factura?: ${order.requiresPurchaseOrder ?? '—'}`,
    `- Observaciones: ${order.observations ?? '—'}`,
  ].join('\n');
}

function buildDealProductComment(order: NormalizedWooOrder): string {
  const studentsLines = order.students.length
    ? order.students
        .map((student) => `${student.firstName ?? '—'} | ${student.lastName ?? '—'} | ${student.dni ?? '—'}`)
        .join(' ;\n')
    : 'Sin alumnos informados';

  return [
    'Reserva de formación',
    `Formación: ${order.productName ?? '—'}`,
    `Día de la formación: ${order.rawDate ?? '—'}`,
    `Sede: ${order.rawLocation ?? '—'}`,
    `Número de alumnos ${String(order.quantity)}`,
    '"Alumnos de la formación"',
    studentsLines,
    '',
    '“Detalles”',
    `- ¿Vas a gestionar FUNDAE?: ${order.fundae ?? '—'}`,
    `- ¿Es necesario que nos envíe una orden de compra antes de generar la factura?: ${order.requiresPurchaseOrder ?? '—'}`,
    `- Observaciones: ${order.observations ?? '—'}`,
  ].join('\n');
}

function buildOrganizationPayload(order: NormalizedWooOrder) {
  const address = buildAddress(order);
  return {
    name: order.companyName ?? joinNonEmpty([order.billingFirstName, order.billingLastName]) ?? `Pedido WC ${order.orderNumber}`,
    owner_id: DEFAULT_ORG_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    address,
    [ORG_CIF_FIELD_KEY]: order.billingCif,
    [ORG_PHONE_FIELD_KEY]: order.billingPhone,
    [ORG_EMAIL_FIELD_KEY]: order.billingEmail,
    [ORG_TRAFFIC_SOURCE_FIELD_KEY]: order.trafficSource,
  };
}

function buildPersonPayload(order: NormalizedWooOrder, organizationId: string) {
  return {
    name: joinNonEmpty([order.billingFirstName, order.billingLastName]) ?? order.billingEmail ?? order.orderNumber,
    first_name: order.billingFirstName,
    last_name: order.billingLastName,
    owner_id: DEFAULT_ORG_OWNER_ID,
    org_id: organizationId,
    visible_to: DEFAULT_VISIBLE_TO,
    email: order.billingEmail ? [{ value: order.billingEmail, primary: true }] : undefined,
    phone: order.billingPhone ? [{ value: order.billingPhone, primary: true }] : undefined,
    [PERSON_CIF_FIELD_KEY]: order.billingCif,
    [PERSON_ADDRESS_FIELD_KEY]: buildAddress(order),
    [PERSON_TRAFFIC_SOURCE_FIELD_KEY]: order.trafficSource,
  };
}

function buildDealCreatePayload(
  order: NormalizedWooOrder,
  organizationId: string,
  personId: string,
  singleOptionValues: DealSingleOptionValues,
) {
  return {
    title: buildDealTitle(order),
    status: 'open',
    stage_id: DEFAULT_OPEN_STAGE_ID,
    pipeline_id: DEFAULT_PIPELINE_ID,
    user_id: DEFAULT_ORG_OWNER_ID,
    org_id: organizationId,
    person_id: personId,
    visible_to: DEFAULT_VISIBLE_TO,
    [DEAL_SERVICE_FIELD_KEY]: DEAL_INITIAL_SERVICE_VALUE,
    [DEAL_TRAINING_DATE_FIELD_KEY]: order.formattedDate,
    [DEAL_TRAINING_FIELD_KEY]: singleOptionValues.trainingOptionId,
    [DEAL_WC_ORDER_FIELD_KEY]: order.orderId,
    [DEAL_TRAFFIC_SOURCE_FIELD_KEY]: order.trafficSource,
    [DEAL_SOURCE_FIELD_KEY]: DEAL_INITIAL_SOURCE_VALUE,
    [DEAL_CONSTANT_STATUS_FIELD_KEY]: DEAL_CONSTANT_STATUS_VALUE,
  };
}

function buildDealUpdatePayload(order: NormalizedWooOrder, singleOptionValues: DealSingleOptionValues) {
  return {
    status: 'won',
    stage_id: DEFAULT_WON_STAGE_ID,
    user_id: DEFAULT_ORG_OWNER_ID,
    visible_to: DEFAULT_VISIBLE_TO,
    currency: order.subtotal > 0 ? 'EUR' : undefined,
    [DEAL_SERVICE_FIELD_KEY]: DEAL_WON_SERVICE_VALUE,
    [DEAL_TRAINING_FIELD_KEY]: singleOptionValues.trainingOptionId,
    [DEAL_SITE_FIELD_KEY]: singleOptionValues.siteOptionId,
    [DEAL_STUDENTS_FIELD_KEY]: String(order.quantity),
    [DEAL_FUNDAE_FIELD_KEY]: singleOptionValues.fundaeOptionId,
    [DEAL_WC_ORDER_FIELD_KEY]: `Order en Woocommerce: ${order.orderNumber}`,
    [DEAL_SKU_FIELD_KEY]: order.sku,
    [DEAL_VARIATION_FIELD_KEY]: order.variationIdWoo,
    [DEAL_CONSTANT_STATUS_FIELD_KEY]: DEAL_CONSTANT_STATUS_VALUE,
  };
}

function buildAddProductPayload(order: NormalizedWooOrder, productIdPipe: string, discountPercentage: number) {
  const normalizedProductId = toIntegerIdOrNull(productIdPipe);
  if (normalizedProductId === null) {
    throw new Error(`El product_id de Pipedrive no es un entero válido: ${productIdPipe}`);
  }

  return {
    product_id: normalizedProductId,
    item_price: order.subtotal,
    quantity: 1,
    discount_percentage: discountPercentage > 0 ? discountPercentage : undefined,
    discount_type: 'percentage',
    tax_method: 'exclusive',
    tax_percentage: 21,
    comments: buildDealProductComment(order),
    enabled_flag: 1,
  };
}

function extractSearchItems(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function extractItemEntity(entry: any): any {
  if (entry?.item) return entry.item;
  return entry;
}

async function pdRequest(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}) {
  const baseUrl = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    throw new Error('Falta PIPEDRIVE_API_TOKEN en variables de entorno');
  }

  const url = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}api_token=${token}`;
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`[pipedrive] ${init.method ?? 'GET'} ${path} -> ${response.status} ${text}`);
  }
  return json;
}

function findExactOrganization(items: any[], cif: string | null, companyName: string | null): any | null {
  const normalizedCif = readString(cif)?.toLowerCase() ?? null;
  const normalizedCompany = readString(companyName)?.toLowerCase() ?? null;

  for (const entry of items) {
    const item = extractItemEntity(entry);
    const itemCif = readString(item?.[ORG_CIF_FIELD_KEY])?.toLowerCase() ?? null;
    if (normalizedCif && itemCif === normalizedCif) {
      return item;
    }
  }

  for (const entry of items) {
    const item = extractItemEntity(entry);
    const name = readString(item?.name)?.toLowerCase() ?? null;
    if (normalizedCompany && name === normalizedCompany) {
      return item;
    }
  }

  return null;
}

async function searchOrganization(order: NormalizedWooOrder): Promise<any | null> {
  const queries = [order.billingCif, order.companyName].filter((value): value is string => Boolean(readString(value)));
  for (const query of queries) {
    const response = await pdRequest(
      `/organizations/search?term=${encodeURIComponent(query)}&fields=custom_fields,name&exact_match=true&limit=10`,
    );
    const match = findExactOrganization(extractSearchItems(response), order.billingCif, order.companyName);
    if (match) return match;
  }
  return null;
}

function findExactPerson(items: any[], phone: string | null, email: string | null): any | null {
  const normalizedPhone = readString(phone);
  const normalizedEmail = readString(email)?.toLowerCase() ?? null;

  for (const entry of items) {
    const item = extractItemEntity(entry);
    const phones = readArray(item?.phone)
      .map((value) => readString(readObject(value)?.value ?? value))
      .filter((value): value is string => Boolean(value));
    if (normalizedPhone && phones.some((candidate) => candidate.replace(/\s+/g, '') === normalizedPhone.replace(/\s+/g, ''))) {
      return item;
    }
  }

  for (const entry of items) {
    const item = extractItemEntity(entry);
    const emails = readArray(item?.email)
      .map((value) => readString(readObject(value)?.value ?? value)?.toLowerCase() ?? null)
      .filter((value): value is string => Boolean(value));
    if (normalizedEmail && emails.includes(normalizedEmail)) {
      return item;
    }
  }

  return null;
}

async function searchPerson(order: NormalizedWooOrder): Promise<any | null> {
  const queries = [order.billingPhone, order.billingEmail].filter((value): value is string => Boolean(readString(value)));
  for (const query of queries) {
    const response = await pdRequest(
      `/persons/search?term=${encodeURIComponent(query)}&fields=phone,email,name&exact_match=true&limit=10`,
    );
    const match = findExactPerson(extractSearchItems(response), order.billingPhone, order.billingEmail);
    if (match) return match;
  }
  return null;
}

function findExactDeal(items: any[], title: string): any | null {
  const normalizedTitle = title.trim().toLowerCase();
  for (const entry of items) {
    const item = extractItemEntity(entry);
    const itemTitle = readString(item?.title)?.toLowerCase() ?? null;
    if (itemTitle === normalizedTitle) {
      return item;
    }
  }
  return null;
}

async function searchDeal(title: string): Promise<any | null> {
  const response = await pdRequest(
    `/deals/search?term=${encodeURIComponent(title)}&fields=title&exact_match=true&limit=10`,
  );
  return findExactDeal(extractSearchItems(response), title);
}

function extractEntityId(entity: any): string | null {
  const directId = readString(entity?.id);
  if (directId) return directId;
  const itemId = readString(entity?.item?.id);
  return itemId;
}

async function ensureNote(dealId: string, personId: string, organizationId: string, content: string): Promise<boolean> {
  const existingNotes = await getDealNotes(dealId);
  const notes = Array.isArray(existingNotes) ? existingNotes : [];
  if (notes.some((note) => readString((note as any)?.content) === content)) {
    return false;
  }

  await pdRequest('/notes', {
    method: 'POST',
    body: {
      content,
      deal_id: dealId,
      person_id: personId,
      org_id: organizationId,
      pinned_to_deal_flag: 1,
    },
  });
  return true;
}

async function ensureDealProduct(
  dealId: string,
  productIdPipe: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const existingProducts = await getDealProducts(dealId);
  const products = Array.isArray(existingProducts) ? existingProducts : [];
  if (
    products.some((product) => readString((product as any)?.product_id) === productIdPipe || readString((product as any)?.product?.id) === productIdPipe)
  ) {
    return false;
  }

  await pdRequest(`/deals/${encodeURIComponent(dealId)}/products`, {
    method: 'POST',
    body: payload,
  });
  return true;
}

export async function sendWooOrderToPipedrive(params: {
  prisma: PrismaClient;
  webhookEventId: string;
}): Promise<PipedriveSyncResult> {
  const record = await params.prisma.woocommerce_compras_webhooks.findUnique({
    where: { id: params.webhookEventId },
    select: { id: true, payload_json: true },
  });

  if (!record) {
    throw new Error('No se ha encontrado el webhook de WooCommerce solicitado.');
  }

  const payload = readObject(record.payload_json) ?? {};
  const order = normalizeWooOrder(payload);
  if (!order.orderId || !order.orderNumber) {
    throw new Error('El webhook no contiene un pedido de WooCommerce válido.');
  }

  const warnings: string[] = [];
  const classification = classifyOrder(order);
  const resolvedProduct = await resolveProduct(params.prisma, order);
  const singleOptionValues = await resolveDealSingleOptionValues(params.prisma, order);
  if (!resolvedProduct.idPipe) {
    warnings.push('No se ha encontrado el producto de Pipedrive vinculado al pedido.');
  }
  if (singleOptionValues.trainingLookupLabel && !singleOptionValues.trainingOptionId) {
    warnings.push(`No se ha encontrado la opción de Pipedrive para Formación con el valor "${singleOptionValues.trainingLookupLabel}".`);
  }
  if (singleOptionValues.siteLookupLabel && !singleOptionValues.siteOptionId) {
    warnings.push(`No se ha encontrado la opción de Pipedrive para Sede de la Formación con el valor "${singleOptionValues.siteLookupLabel}".`);
  }
  if (singleOptionValues.fundaeLookupLabel && !singleOptionValues.fundaeOptionId) {
    warnings.push(`No se ha encontrado la opción de Pipedrive para FUNDAE con el valor "${singleOptionValues.fundaeLookupLabel}".`);
  }

  const organizationPayload = buildOrganizationPayload(order);
  const existingOrganization = await searchOrganization(order);
  const organizationEntity = existingOrganization
    ? await pdRequest(`/organizations/${encodeURIComponent(String(extractEntityId(existingOrganization)))}`, {
        method: 'PUT',
        body: organizationPayload,
      })
    : await pdRequest('/organizations', { method: 'POST', body: organizationPayload });
  const organizationId = extractEntityId(organizationEntity?.data ?? organizationEntity);
  if (!organizationId) {
    throw new Error('No se ha podido resolver la organización en Pipedrive.');
  }

  const personPayload = buildPersonPayload(order, organizationId);
  const existingPerson = await searchPerson(order);
  const personEntity = existingPerson
    ? await pdRequest(`/persons/${encodeURIComponent(String(extractEntityId(existingPerson)))}`, {
        method: 'PUT',
        body: personPayload,
      })
    : await pdRequest('/persons', { method: 'POST', body: personPayload });
  const personId = extractEntityId(personEntity?.data ?? personEntity);
  if (!personId) {
    throw new Error('No se ha podido resolver la persona en Pipedrive.');
  }

  const dealTitle = buildDealTitle(order);
  const existingDeal = await searchDeal(dealTitle);
  const dealEntity = existingDeal
    ? await pdRequest(`/deals/${encodeURIComponent(String(extractEntityId(existingDeal)))}`, {
        method: 'PUT',
        body: buildDealCreatePayload(order, organizationId, personId, singleOptionValues),
      })
    : await pdRequest('/deals', {
        method: 'POST',
        body: buildDealCreatePayload(order, organizationId, personId, singleOptionValues),
      });
  const dealId = extractEntityId(dealEntity?.data ?? dealEntity);
  if (!dealId) {
    throw new Error('No se ha podido resolver el deal en Pipedrive.');
  }

  let productAdded = false;
  if (resolvedProduct.idPipe) {
    productAdded = await ensureDealProduct(
      dealId,
      resolvedProduct.idPipe,
      buildAddProductPayload(order, resolvedProduct.idPipe, classification.discountPercentage),
    );
  }

  const notesCreated: string[] = [];
  const studentsNoteCreated = await ensureNote(
    dealId,
    personId,
    organizationId,
    buildStudentsNote(order),
  );
  if (studentsNoteCreated) notesCreated.push('students');

  const detailsNoteCreated = await ensureNote(
    dealId,
    personId,
    organizationId,
    buildDetailsNote(order),
  );
  if (detailsNoteCreated) notesCreated.push('details');

  await pdRequest(`/deals/${encodeURIComponent(dealId)}`, {
    method: 'PUT',
    body: buildDealUpdatePayload(order, singleOptionValues),
  });

  if (classification.requiresFundae) {
    warnings.push('El pedido requiere gestión FUNDAE: revisa la comunicación interna adicional fuera de Pipedrive.');
  }
  if (classification.requiresPurchaseOrder) {
    warnings.push('El pedido indica orden de compra: revisa el seguimiento administrativo.');
  }
  if (classification.type === 'partner') {
    warnings.push(
      `Pedido partner detectado${classification.discountPercentage ? ` con descuento ${classification.discountPercentage}%` : ''}.`,
    );
  }

  const presupuesto = dealId;

  await params.prisma.woocommerce_compras_webhooks.update({
    where: { id: params.webhookEventId },
    data: { presupuesto },
  });

  return {
    organizationId,
    personId,
    dealId,
    presupuesto,
    organizationCreated: !existingOrganization,
    personCreated: !existingPerson,
    dealCreated: !existingDeal,
    productAdded,
    notesCreated,
    warnings,
  };
}
