import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { getOrganizationFields, getPipelines } from './_shared/pipedrive';

const CHANNEL_FIELD_KEY = '6eb20e6b912f055c127241c9012f20a8223637f6';

type PipedrivePipeline = {
  id?: number | string;
  name?: string | null;
};

type PipedriveFieldOption = {
  id?: number | string;
  label?: string | null;
  value?: string | number | null;
};

type PipedriveField = {
  id?: number | string;
  key?: string | null;
  options?: PipedriveFieldOption[] | null;
};

function normalizePipeline(pipeline: PipedrivePipeline) {
  const id = pipeline.id;
  const name = pipeline.name?.trim();
  if (!id || !name) {
    return null;
  }

  return {
    id: String(id),
    name,
  };
}

function normalizeChannelOption(option: PipedriveFieldOption) {
  const label = option.label?.trim();
  if (!label) {
    return null;
  }

  const id = option.id ?? option.value ?? label;

  return {
    id: String(id),
    label,
  };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const [pipelinesRaw, orgFieldsRaw] = await Promise.all([
    getPipelines(),
    getOrganizationFields(),
  ]);

  const pipelines = Array.isArray(pipelinesRaw)
    ? pipelinesRaw.map(normalizePipeline).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const orgFields = Array.isArray(orgFieldsRaw) ? (orgFieldsRaw as PipedriveField[]) : [];
  const channelField = orgFields.find(
    (field) =>
      field?.key === CHANNEL_FIELD_KEY ||
      (field?.id != null && String(field.id) === CHANNEL_FIELD_KEY),
  );
  const channelOptions = Array.isArray(channelField?.options) ? channelField.options : [];
  const channels = channelOptions
    .map(normalizeChannelOption)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return successResponse({ pipelines, channels });
});
