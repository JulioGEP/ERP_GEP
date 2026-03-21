import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import { getDealFieldByCode, getOrganizationFieldByCode } from './_shared/pipedrive';

const ALLOWED_ROLES = ['Admin'] as const;

type PipedriveFieldScope = 'deal' | 'organization';

const TARGET_FIELDS = [
  {
    fieldKey: 'c99554c188c3f63ad9bc8b2cf7b50cbd145455ab',
    fallbackName: 'Formacion',
    scope: 'deal',
  },
  {
    fieldKey: '676d6bd51e52999c582c01f67c99a35ed30bf6ae',
    fallbackName: 'Sede de la formación',
    scope: 'deal',
  },
  {
    fieldKey: '245d60d4d18aec40ba888998ef92e5d00e494583',
    fallbackName: 'FUNDAE',
    scope: 'deal',
  },
  {
    fieldKey: '8a65e9b780cbab3f08ccc8babe92a290fb79f216',
    fallbackName: 'Tipo de empresa',
    scope: 'organization',
  },
  {
    fieldKey: '6eb20e6b912f055c127241c9012f20a8223637f6',
    fallbackName: 'Canal Adquisición',
    scope: 'organization',
  },
] as const satisfies ReadonlyArray<{
  fieldKey: string;
  fallbackName: string;
  scope: PipedriveFieldScope;
}>;

type StoredOptionRecord = {
  field_key: string;
  field_name: string;
  field_type: string;
  option_id: string;
  option_label: string;
  option_order: number;
  synced_at: Date;
};

type NormalizedFieldOption = {
  id: string;
  label: string;
  order: number;
};

type NormalizedField = {
  fieldKey: string;
  fieldName: string;
  fieldType: string | null;
  syncedAt: string | null;
  options: NormalizedFieldOption[];
};

type StoredOptionCreateInput = {
  field_key: string;
  field_name: string;
  field_type: string;
  option_id: string;
  option_label: string;
  option_order: number;
  synced_at: Date;
};

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function buildFieldResponse(records: StoredOptionRecord[]): NormalizedField[] {
  const grouped = new Map<string, StoredOptionRecord[]>();

  for (const record of records) {
    const bucket = grouped.get(record.field_key);
    if (bucket) bucket.push(record);
    else grouped.set(record.field_key, [record]);
  }

  return TARGET_FIELDS.map((target) => {
    const rows = grouped.get(target.fieldKey) ?? [];
    const first = rows[0] ?? null;
    const syncedAt =
      rows.reduce<Date | null>(
        (latest, row) => (!latest || row.synced_at > latest ? row.synced_at : latest),
        null,
      ) ?? null;

    return {
      fieldKey: target.fieldKey,
      fieldName: first?.field_name ?? target.fallbackName,
      fieldType: first?.field_type ?? null,
      syncedAt: syncedAt ? toMadridISOString(syncedAt) : null,
      options: rows
        .map((row) => ({
          id: row.option_id,
          label: row.option_label,
          order: row.option_order,
        }))
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'es')),
    };
  });
}

async function listStoredFields() {
  const prisma = getPrisma();
  const rows = (await prisma.pipedrive_custom_field_options.findMany({
    where: {
      field_key: {
        in: TARGET_FIELDS.map((field) => field.fieldKey),
      },
    },
    orderBy: [{ field_key: 'asc' }, { option_order: 'asc' }, { option_label: 'asc' }],
  })) as StoredOptionRecord[];

  return buildFieldResponse(rows);
}

async function syncFieldsFromPipedrive() {
  const prisma = getPrisma();
  const syncedAt = new Date();

  const resolvedFields = await Promise.all(
    TARGET_FIELDS.map(async (target) => {
      const field =
        target.scope === 'organization'
          ? await getOrganizationFieldByCode(target.fieldKey)
          : await getDealFieldByCode(target.fieldKey);
      const fieldName = normalizeString(field?.name) ?? target.fallbackName;
      const fieldType = normalizeString(field?.field_type) ?? normalizeString(field?.fieldType) ?? 'enum';
      const optionsRaw = Array.isArray(field?.options) ? field.options : [];
      const options = optionsRaw
        .map((option: any, index: number): StoredOptionCreateInput | null => {
          const optionId = normalizeString(option?.id ?? option?.key);
          const optionLabel = normalizeString(option?.label ?? option?.name ?? option?.value);
          if (!optionId || !optionLabel) return null;
          const orderRaw = option?.order_nr ?? option?.orderNumber ?? option?.order ?? index;
          const order = Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : index;
          return {
            field_key: target.fieldKey,
            field_name: fieldName,
            field_type: fieldType,
            option_id: optionId,
            option_label: optionLabel,
            option_order: order,
            synced_at: syncedAt,
          };
        })
        .filter((option: StoredOptionCreateInput | null): option is StoredOptionCreateInput => Boolean(option));

      return { options };
    }),
  );

  const operations = [
    prisma.pipedrive_custom_field_options.deleteMany({
      where: {
        field_key: {
          in: TARGET_FIELDS.map((field) => field.fieldKey),
        },
      },
    }),
    ...resolvedFields
      .filter((field) => field.options.length > 0)
      .map((field) =>
        prisma.pipedrive_custom_field_options.createMany({
          data: field.options,
        }),
      ),
  ];

  await prisma.$transaction(operations);

  return listStoredFields();
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ALLOWED_ROLES });
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'GET') {
    const fields = await listStoredFields();
    return successResponse({ fields });
  }

  if (request.method === 'POST') {
    try {
      const fields = await syncFieldsFromPipedrive();
      return successResponse({ fields, message: 'Campos de Pipedrive actualizados correctamente.' });
    } catch (error) {
      console.error('[pipedrive-custom-fields] sync failed', error);
      const message = error instanceof Error ? error.message : 'No se pudieron actualizar los campos de Pipedrive.';
      return errorResponse('PIPEDRIVE_CUSTOM_FIELDS_SYNC_ERROR', message, 502);
    }
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
});
