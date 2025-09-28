import type { DealSummary } from '../types/deal';
import { pipedriveClient } from './pipedriveClient';
import { prisma } from './prisma';

const DEAL_CUSTOM_FIELDS = {
  hours: '38f11c8876ecde803a027fbf3c9041fda2ae7eb7',
  direction: '8b2a7570f5ba8aa4754f061cd9dc92fd778376a7',
  sede: '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
  caes: 'e1971bf3a21d48737b682bf8d864ddc5eb15a351',
  fundae: '245d60d4d18aec40ba888998ef92e5d00e494583',
  hotelNight: 'c3a6daf8eb5b4e59c3c07cda8e01f43439101269',
  pipeline: 'pipeline_id'
} as const;

const ORGANIZATION_CUSTOM_FIELDS = {
  cif: '6d39d015a33921753410c1bab0b067ca93b8cf2c',
  phone: 'b4379db06dfbe0758d84c2c2dd45ef04fa093b6d'
} as const;

type DealResponse = {
  id: number;
  title: string;
  org_id?: { value: number; name: string } | number;
  person_id?: { value: number } | number;
  [key: string]: unknown;
};

type ProductResponse = {
  product_id: number;
  name: string;
  code?: string;
  quantity?: number | string;
};

type OrganizationResponse = {
  id: number;
  name: string;
  address?: string;
  [key: string]: unknown;
};

type PersonResponse = {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: Array<{ value: string; primary?: boolean }> | string;
  phone?: Array<{ value: string; primary?: boolean }> | string;
};

type NoteResponse = {
  id: number;
  content: string;
};

type FileResponse = {
  id: number;
  name: string;
  file_url?: string;
};

function extractField<T>(entity: Record<string, unknown> | null | undefined, key: string): T | null {
  if (!entity) {
    return null;
  }

  const value = entity[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return ((value as Record<string, unknown>).value ?? null) as T | null;
  }
  return value as T;
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function extractPrimaryFromField(field: PersonResponse['email']): string | null {
  if (!field) {
    return null;
  }

  if (typeof field === 'string') {
    return field;
  }

  const values = field as Array<{ value: string; primary?: boolean }>;
  const primary = values.find((entry) => entry.primary);
  return (primary ?? values[0])?.value ?? null;
}

function parseQuantity(quantity: ProductResponse['quantity']): number {
  if (quantity === null || quantity === undefined) {
    return 0;
  }

  if (typeof quantity === 'number') {
    return quantity;
  }

  const parsed = parseInt(quantity, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function importDealFromPipedrive(federalNumber: string): Promise<DealSummary> {
  const dealResponse = await pipedriveClient.get<{ data: (DealResponse & { products?: ProductResponse[] }) | null }>(
    `/deals/${encodeURIComponent(federalNumber)}`,
    { params: { include_products: 1 } }
  );

  const dealData = dealResponse.data?.data;

  if (!dealData) {
    throw new Error('No se ha encontrado el presupuesto solicitado en Pipedrive.');
  }

  const orgRaw = dealData.org_id;
  const orgId = typeof orgRaw === 'object' ? orgRaw?.value : orgRaw;

  if (!orgId) {
    throw new Error('El presupuesto no tiene una organización asociada.');
  }

  const personId = dealData.person_id
    ? typeof dealData.person_id === 'object'
      ? dealData.person_id.value
      : dealData.person_id
    : null;

  const [organizationResponse, personResponse, notesResponse, filesResponse] = await Promise.all([
    pipedriveClient.get<{ data: OrganizationResponse | null }>(`/organizations/${orgId}`),
    personId
      ? pipedriveClient.get<{ data: PersonResponse | null }>(`/persons/${personId}`)
      : Promise.resolve<{ data: PersonResponse | null }>({ data: null }),
    pipedriveClient.get<{ data: NoteResponse[] | null }>(`/deals/${dealData.id}/notes`),
    pipedriveClient.get<{ data: FileResponse[] | null }>(`/deals/${dealData.id}/files`)
  ]);

  const organizationData = organizationResponse.data ?? null;
  const primaryPerson = personResponse.data ?? null;
  const notes = notesResponse.data ?? [];
  const files = filesResponse.data ?? [];

  const products = ensureArray((dealData as DealResponse & { products?: ProductResponse[] }).products);
  const trainingProducts = products.filter((product) => product.code?.toLowerCase().startsWith('form-'));
  const extraProducts = products.filter((product) => !(product.code?.toLowerCase().startsWith('form-') ?? false));

  const sedeValue = extractField<string>(dealData, DEAL_CUSTOM_FIELDS.sede) ?? '';
  const trainingType = extractField<string>(dealData, DEAL_CUSTOM_FIELDS.pipeline);
  const hoursValue = extractField<number | string>(dealData, DEAL_CUSTOM_FIELDS.hours);
  const parsedHours =
    hoursValue === null || hoursValue === undefined
      ? null
      : typeof hoursValue === 'number'
      ? hoursValue
      : Number.isNaN(parseInt(hoursValue, 10))
      ? null
      : parseInt(hoursValue, 10);
  const sessionsCount = trainingProducts.reduce((total, product) => total + parseQuantity(product.quantity), 0);

  const dealSummary: DealSummary = {
    dealId: dealData.id,
    title: dealData.title,
    clientName: organizationData?.name ?? 'Organización sin nombre',
    sede: sedeValue,
    trainingNames: trainingProducts.map((product) => product.name).filter(Boolean),
    trainingType,
    hours: parsedHours,
    caes: extractField<string>(dealData, DEAL_CUSTOM_FIELDS.caes),
    fundae: extractField<string>(dealData, DEAL_CUSTOM_FIELDS.fundae),
    hotelNight: extractField<string>(dealData, DEAL_CUSTOM_FIELDS.hotelNight),
    notes: notes.map((note) => note.content),
    documents: files.map((file) => file.name)
  };

  await prisma.$transaction(async (tx) => {
    await tx.organization.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        name: organizationData?.name ?? 'Organización sin nombre',
        cif: extractField<string>(organizationData, ORGANIZATION_CUSTOM_FIELDS.cif),
        phone: extractField<string>(organizationData, ORGANIZATION_CUSTOM_FIELDS.phone),
        address: organizationData?.address ?? null
      },
      update: {
        name: organizationData?.name ?? 'Organización sin nombre',
        cif: extractField<string>(organizationData, ORGANIZATION_CUSTOM_FIELDS.cif),
        phone: extractField<string>(organizationData, ORGANIZATION_CUSTOM_FIELDS.phone),
        address: organizationData?.address ?? null
      }
    });

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

      await tx.dealParticipant.upsert({
        where: { dealId_personId: { dealId: dealData.id, personId: primaryPerson.id } },
        create: {
          dealId: dealData.id,
          personId: primaryPerson.id,
          role: 'Responsable'
        },
        update: {
          role: 'Responsable'
        }
      });
    }

    await tx.deal.upsert({
      where: { id: dealData.id },
      create: {
        id: dealData.id,
        organizationId: orgId,
        title: dealData.title,
        trainingType,
        hours: parsedHours,
        direction: extractField<string>(dealData, DEAL_CUSTOM_FIELDS.direction),
        sede: sedeValue,
        caes: dealSummary.caes,
        fundae: dealSummary.fundae,
        hotelNight: dealSummary.hotelNight,
        alumnos: 0,
        training: trainingProducts,
        prodExtra: extraProducts,
        documentsNum: files.length,
        documentsIds: files.map((file) => file.id).join(',') || null,
        sessionsNum: sessionsCount,
        sessionsIds: null,
        notesNum: notes.length
      },
      update: {
        organizationId: orgId,
        title: dealData.title,
        trainingType,
        hours: parsedHours,
        direction: extractField<string>(dealData, DEAL_CUSTOM_FIELDS.direction),
        sede: sedeValue,
        caes: dealSummary.caes,
        fundae: dealSummary.fundae,
        hotelNight: dealSummary.hotelNight,
        training: trainingProducts,
        prodExtra: extraProducts,
        documentsNum: files.length,
        documentsIds: files.map((file) => file.id).join(',') || null,
        sessionsNum: sessionsCount,
        notesNum: notes.length
      }
    });

    await tx.note.deleteMany({ where: { dealId: dealData.id } });
    if (notes.length) {
      await tx.note.createMany({
        data: notes.map((note) => ({
          id: note.id,
          dealId: dealData.id,
          comment: note.content
        }))
      });
    }

    await tx.document.deleteMany({ where: { dealId: dealData.id } });
    if (files.length) {
      await tx.document.createMany({
        data: files.map((file) => ({
          id: file.id,
          dealId: dealData.id,
          title: file.name,
          url: file.file_url ?? null
        }))
      });
    }
  });

  return dealSummary;
}
