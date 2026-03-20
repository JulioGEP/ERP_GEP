import { requestJson, toStringValue } from '../../api/client';

export type PipedriveCustomFieldOption = {
  id: string;
  label: string;
  order: number;
};

export type PipedriveCustomField = {
  fieldKey: string;
  fieldName: string;
  fieldType: string | null;
  syncedAt: string | null;
  options: PipedriveCustomFieldOption[];
};

type PipedriveCustomFieldsApiResponse = {
  fields?: unknown;
};

export const PIPEDRIVE_CUSTOM_FIELDS_QUERY_KEY = ['pipedrive-custom-fields'] as const;

function normalizeOption(row: any): PipedriveCustomFieldOption {
  const id = toStringValue(row?.id);
  const label = toStringValue(row?.label);
  const orderValue = Number(row?.order);

  if (!id) {
    throw new Error('La respuesta del servidor incluye una opción sin id.');
  }

  if (!label) {
    throw new Error('La respuesta del servidor incluye una opción sin nombre.');
  }

  return {
    id,
    label,
    order: Number.isFinite(orderValue) ? orderValue : 0,
  };
}

function normalizeField(row: any): PipedriveCustomField {
  const fieldKey = toStringValue(row?.fieldKey);
  const fieldName = toStringValue(row?.fieldName);
  const fieldType = toStringValue(row?.fieldType);
  const syncedAt = toStringValue(row?.syncedAt);
  const optionsRaw = Array.isArray(row?.options) ? row.options : [];

  if (!fieldKey) {
    throw new Error('La respuesta del servidor incluye un campo sin fieldKey.');
  }

  if (!fieldName) {
    throw new Error('La respuesta del servidor incluye un campo sin nombre.');
  }

  return {
    fieldKey,
    fieldName,
    fieldType,
    syncedAt,
    options: optionsRaw.map((option) => normalizeOption(option)),
  };
}

function normalizeResponse(data: PipedriveCustomFieldsApiResponse): PipedriveCustomField[] {
  const fieldsRaw = Array.isArray(data.fields) ? data.fields : [];
  return fieldsRaw.map((field) => normalizeField(field));
}

export async function fetchPipedriveCustomFields(): Promise<PipedriveCustomField[]> {
  const data = await requestJson<PipedriveCustomFieldsApiResponse>('pipedrive-custom-fields');
  return normalizeResponse(data);
}

export async function syncPipedriveCustomFields(): Promise<PipedriveCustomField[]> {
  const data = await requestJson<PipedriveCustomFieldsApiResponse>('pipedrive-custom-fields', {
    method: 'POST',
  });
  return normalizeResponse(data);
}
