import type { DealSummary } from '../types/deal';
import { pipedriveClient } from './pipedriveClient';
import { prisma } from './prisma';

/** Claves custom del Deal (Pipedrive) */
const DEAL_CUSTOM_FIELDS = {
  hours: '38f11c8876ecde803a027fbf3c9041fda2ae7eb7',
  direction: '8b2a7570f5ba8aa4754f061cd9dc92fd778376a7',
  sede: '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
  caes: 'e1971bf3a21d48737b682bf8d864ddc5eb15a351',
  fundae: '245d60d4d18aec40ba888998ef92e5d00e494583',
  hotelNight: 'c3a6daf8eb5b4e59c3c07cda8e01f43439101269',
  pipeline: 'pipeline_id'
} as const;

/** Claves custom de Organization (Pipedrive) */
const ORGANIZATION_CUSTOM_FIELDS = {
  cif: '6d39d015a33921753410c1bab0b067ca93b8cf2c',
  phone: 'b4379db06dfbe0758d84c2c2dd45ef04fa093b6d'
} as const;

/** Tipos mínimos de respuestas Pipedrive */
type DealResponse = {
  id: number;
  title: string;
  org_id?: { value: number; name?: string | null } | number | null;
  person_id?: { value: number } | number | null;
  [key: string]: unknown;
};

type ProductResponse = {
  product_id: number;
  name: string;
  code?: string | null;
  quantity?: number | string | null;
};

type OrganizationResponse = {
  id: number;
  name?: string | null;
  address?: string | null;
  [key: string]: unknown;
};

type PersonResponse = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: Array<{ value: string; primary?: boolean }> | string | null;
  phone?: Array<{ value: string; primary?: boolean }> | string | null;
};

type NoteResponse = {
  id: number;
  content: string;
};

type FileResponse = {
  id: number;
  name: string;
  file_url?: string | null;
};

/** =======================
 *  Helpers de extracción
 *  ======================= */
function extractField<T>(entity: Record<string, unknown> | null | undefined, key: string): T | null {
  if (!entity) return null;
  const value = entity[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return ((value as Record<string, unknown>).value ?? null) as T | null;
  }
  return value as T;
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractPrimaryFromField(field: PersonResponse['email'] | PersonResponse['phone']): string | null {
  if (!field) return null;
  if (typeof field === 'string') return field;
  const values = field as Array<{ value: string; primary?: boolean }>;
  if (!values.length) return null;
  const primary = values.find((entry) => entry.primary);
  return (primary ?? values[0])?.value ?? null;
}

function parseQuantity(quantity: ProductResponse['quantity']): number {
  if (quantity === null || quantity === undefined) return 0;
  if (typeof quantity === 'number') return Number.isFinite(quantity) ? quantity : 0;
  const parsed = parseInt(String(quantity), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** =========================================
 *  Cache en memoria para opciones de campos
 *  ========================================= */
type FieldOption = { id: number | string; label: string };
type FieldOptionsMap = Map<string | number, string>;

const fieldOptionsCache = new Map<string, FieldOptionsMap>();

async function fetchFieldByKeyOrId(fieldKeyOrId: string): Promise<Array<FieldOption>> {
  // 1) Intento directo por ID (solo vale si es ID numérico válido en Pipedrive)
  try {
    const one = await pipedriveClient.get<{ data: { options?: FieldOption[] } | null }>(
      `/dealFields/${encodeURIComponent(fieldKeyOrId)}`
    );
    if (one.data?.data?.options?.length) return one.data.data.options;
  } catch {
    // Ignoramos; seguimos con listado
  }

  // 2) Listado completo y búsqueda por key o id
  const list = await pipedriveClient.get<{
    data: Array<{ id: number; key: string; options?: FieldOption[] }> | null;
  }>(`/dealFields`);

  const all = list.data?.data ?? [];
  const match =
    all.find((f) => f.key === fieldKeyOrId) ||
    all.find((f) => String(f.id) === String(fieldKeyOrId));

  return match?.options ?? [];
}

async function getFieldOptions(fieldKey: string): Promise<FieldOptionsMap> {
  const cached = fieldOptionsCache.get(fieldKey);
  if (cached) return cached;

  const optionsArr = await fetchFieldByKeyOrId(fieldKey);
  const map: FieldOptionsMap = new Map(optionsArr.map((opt) => [opt.id, opt.label]));
  fieldOptionsCache.set(fieldKey, map);
  return map;
}

async function mapCustomFieldOption(fieldKey: string, raw: string | number | null | undefined): Promise<string | null> {
  if (raw === null || raw === undefined) return null;
  const options = await getFieldOptions(fieldKey);

  if (options.has(raw)) return options.get(raw)!;

  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && options.has(numeric)) return options.get(numeric)!;

  const asString = String(raw);
  if (options.has(asString)) return options.get(asString)!;

  // Si no encontramos etiqueta, devolvemos el raw como string (mejor que nada)
  return asString;
}

/** ===================
 *  Servicio principal
 *  =================== */
export async function importDealFromPipedrive(federalNumber: string): Promise<DealSummary> {
  // Deal + productos embebidos
  const dealResponse = await pipedriveClient.get<{
    data: (DealResponse & { products?: ProductResponse[] }) | null;
  }>(`/deals/${encodeURIComponent(federalNumber)}`, { params: { include_products: 1 } });

  const dealData = dealResponse.data?.data;
  if (!dealData) {
    throw new Error('No se ha encontrado el presupuesto solicitado en Pipedrive.');
  }

  // orgId normalizado
  const orgRaw = dealData.org_id;
  const orgId: number | null =
    orgRaw == null ? null : typeof orgRaw === 'object' ? (orgRaw?.value as number) : (orgRaw as number);

  if (!orgId) {
    throw new Error('El presupuesto no tiene una organización asociada.');
  }

  // personId normalizado
  const personId: number | null = dealData.person_id
    ? typeof dealData.person_id === 'object'
      ? (dealData.person_id as { value: number }).value
      : (dealData.person_id as number)
    : null;

  // Peticiones paralelas
  const [organizationResponse, personResponse, notesResponse, filesResponse] = await Promise.all([
    pipedriveClient.get<{ data: OrganizationResponse | null }>(`/organizations/${orgId}`),
    personId
      ? pipedriveClient.get<{ data: PersonResponse | null }>(`/persons/${personId}`)
      : Promise.resolve({ data: { data: null } } as { data: { data: PersonResponse | null } }),
    pipedriveClient.get<{ data: NoteResponse[] | null }>(`/deals/${dealData.id}/notes`),
    pipedriveClient.get<{ data: FileResponse[] | null }>(`/deals/${dealData.id}/files`)
  ]);

  // Acceso correcto a response.data.data
  const organizationData: OrganizationResponse | null = organizationResponse.data?.data ?? null;
  const primaryPerson: PersonResponse | null =
    (personResponse as { data: { data: PersonResponse | null } }).data?.data ?? null;
  const notes: NoteResponse[] = Array.isArray(notesResponse.data?.data) ? notesResponse.data!.data : [];
  const files: FileResponse[] = Array.isArray(filesResponse.data?.data) ? filesResponse.data!.data : [];

  // Productos del deal
  const products = ensureArray((dealData as DealResponse & { products?: ProductResponse[] }).products);
  const trainingProducts = products.filter((p) => (p.code ?? '').toLowerCase().startsWith('form-'));
  const extraProducts = products.filter((p) => !(p.code ?? '').toLowerCase().startsWith('form-'));

  // Campos custom (IDs)
  const sedeId = extractField<string | number>(dealData as any, DEAL_CUSTOM_FIELDS.sede);
  const caesId = extractField<string | number>(dealData as any, DEAL_CUSTOM_FIELDS.caes);
  const fundaeId = extractField<string | number>(dealData as any, DEAL_CUSTOM_FIELDS.fundae);
  const hotelId = extractField<string | number>(dealData as any, DEAL_CUSTOM_FIELDS.hotelNight);
  const trainingTypeRaw = extractField<string | number>(dealData as any, DEAL_CUSTOM_FIELDS.pipeline);

  // Mapeo a etiquetas (paralelo + cache + fallback a listado)
  const [sedeLabel, caesLabel, fundaeLabel, hotelLabel] = await Promise.all([
    mapCustomFieldOption(DEAL_CUSTOM_FIELDS.sede, sedeId),
    mapCustomFieldOption(DEAL_CUSTOM_FIELDS.caes, caesId),
    mapCustomFieldOption(DEAL_CUSTOM_FIELDS.fundae, fundaeId),
    mapCustomFieldOption(DEAL_CUSTOM_FIELDS.hotelNight, hotelId)
  ]);

  const trainingTypeStr: string | null =
    trainingTypeRaw === null || trainingTypeRaw === undefined ? null : String(trainingTypeRaw);

  // Horas
  const hoursValue = extractField<number | string>(dealData as any, DEAL_CUSTOM_FIELDS.hours);
  const parsedHours =
    hoursValue === null || hoursValue === undefined
      ? null
      : typeof hoursValue === 'number'
      ? hoursValue
      : Number.isNaN(parseInt(String(hoursValue), 10))
      ? null
      : parseInt(String(hoursValue), 10);

  // Nº sesiones = suma cantidades de productos formativos
  const sessionsCount = trainingProducts.reduce((acc, p) => acc + parseQuantity(p.quantity), 0);

  // Resumen para el front (etiquetas legibles)
  const dealSummary: DealSummary = {
    dealId: dealData.id,
    title: dealData.title,
    clientName: organizationData?.name ?? 'Organización sin nombre',
    sede: sedeLabel ?? (sedeId != null ? String(sedeId) : ''), // etiqueta o fallback id
    trainingNames: trainingProducts.map((p) => p.name).filter(Boolean),
    trainingType: trainingTypeStr ?? undefined,
    hours: parsedHours,
    caes: caesLabel ?? (caesId != null ? String(caesId) : undefined),
    fundae: fundaeLabel ?? (fundaeId != null ? String(fundaeId) : undefined),
    hotelNight: hotelLabel ?? (hotelId != null ? String(hotelId) : undefined),
    notes: notes.map((n) => n.content),
    documents: files.map((f) => f.name)
  };

  // Persistencia (UPSERT) — primero Deal, luego Participant
  await prisma.$transaction(async (tx) => {
    // Organization
    await tx.organization.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        name: organizationData?.name ?? 'Organización sin nombre',
        cif: extractField<string>(organizationData as any, ORGANIZATION_CUSTOM_FIELDS.cif),
        phone: extractField<string>(organizationData as any, ORGANIZATION_CUSTOM_FIELDS.phone),
        address: organizationData?.address ?? null
      },
      update: {
        name: organizationData?.name ?? 'Organización sin nombre',
        cif: extractField<string>(organizationData as any, ORGANIZATION_CUSTOM_FIELDS.cif),
        phone: extractField<string>(organizationData as any, ORGANIZATION_CUSTOM_FIELDS.phone),
        address: organizationData?.address ?? null
      }
    });

    // Persona principal (si existe)
    if (primaryPerson) {
      await tx.person.upsert({
        where: { id: primaryPerson.id },
        create: {
          id: primaryPerson.id,
          organizationId: orgId,
          firstName: primaryPerson.first_name ?? null,
          lastName: primaryPerson.last_name ?? null,
          email: extractPrimaryFromField(primaryPerson.email ?? null),
          phone: extractPrimaryFromField(primaryPerson.phone ?? null)
        },
        update: {
          organizationId: orgId,
          firstName: primaryPerson.first_name ?? null,
          lastName: primaryPerson.last_name ?? null,
          email: extractPrimaryFromField(primaryPerson.email ?? null),
          phone: extractPrimaryFromField(primaryPerson.phone ?? null)
        }
      });
    }

    // Deal
    await tx.deal.upsert({
      where: { id: dealData.id },
      create: {
        id: dealData.id,
        organizationId: orgId,
        title: dealData.title,
        trainingType: trainingTypeStr,
        hours: parsedHours,
        direction: extractField<string>(dealData as any, DEAL_CUSTOM_FIELDS.direction),
        sede: dealSummary.sede,               // guardamos etiqueta legible
        caes: dealSummary.caes,
        fundae: dealSummary.fundae,
        hotelNight: dealSummary.hotelNight,
        alumnos: 0,
        training: trainingProducts,
        prodExtra: extraProducts,
        documentsNum: files.length,
        documentsIds: files.map((f) => f.id).join(',') || null,
        sessionsNum: sessionsCount,
        sessionsIds: null,
        notesNum: notes.length
      },
      update: {
        organizationId: orgId,
        title: dealData.title,
        trainingType: trainingTypeStr,
        hours: parsedHours,
        direction: extractField<string>(dealData as any, DEAL_CUSTOM_FIELDS.direction),
        sede: dealSummary.sede,
        caes: dealSummary.caes,
        fundae: dealSummary.fundae,
        hotelNight: dealSummary.hotelNight,
        training: trainingProducts,
        prodExtra: extraProducts,
        documentsNum: files.length,
        documentsIds: files.map((f) => f.id).join(',') || null,
        sessionsNum: sessionsCount,
        notesNum: notes.length
      }
    });

    // DealParticipant (después de que exista el Deal)
    if (primaryPerson) {
      await tx.dealParticipant.upsert({
        where: { dealId_personId: { dealId: dealData.id, personId: primaryPerson.id } },
        create: { dealId: dealData.id, personId: primaryPerson.id, role: 'Responsable' },
        update: { role: 'Responsable' }
      });
    }

    // Notas
    await tx.note.deleteMany({ where: { dealId: dealData.id } });
    if (notes.length) {
      await tx.note.createMany({
        data: notes.map((n) => ({ id: n.id, dealId: dealData.id, comment: n.content }))
      });
    }

    // Documentos
    await tx.document.deleteMany({ where: { dealId: dealData.id } });
    if (files.length) {
      await tx.document.createMany({
        data: files.map((f) => ({ id: f.id, dealId: dealData.id, title: f.name, url: f.file_url ?? null }))
      });
    }
  });

  return dealSummary;
}
