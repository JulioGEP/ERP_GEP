// frontend/src/features/recursos/confirmations.api.ts
import { ApiError, requestJson, toStringValue } from '../../api/client';

export type TrainerInviteStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';
export type SessionPipelineType = 'FORMACION_EMPRESA' | 'GEP_SERVICES';

export type SessionConfirmationRow = {
  inviteId: string;
  sessionId: string;
  dealId: string | null;
  sessionTitle: string | null;
  productName: string | null;
  pipelineLabel: string | null;
  pipelineType: SessionPipelineType;
  trainerId: string | null;
  trainerName: string | null;
  trainerEmail: string | null;
  status: TrainerInviteStatus;
  startDate: string | null;
  sentAt: string | null;
  respondedAt: string | null;
};

export type VariantConfirmationRow = {
  inviteId: string;
  variantId: string | null;
  variantName: string | null;
  productName: string | null;
  site: string | null;
  date: string | null;
  trainerId: string | null;
  trainerName: string | null;
  trainerEmail: string | null;
  status: TrainerInviteStatus;
  sentAt: string | null;
  respondedAt: string | null;
};

export type ResourcesConfirmationsResponse = {
  sessionInvites: SessionConfirmationRow[];
  variantInvites: VariantConfirmationRow[];
  generatedAt: string | null;
};

export const RESOURCES_CONFIRMATIONS_QUERY_KEY = ['resources-confirmations'] as const;

type ResourcesConfirmationsApiResponse = {
  sessionInvites?: unknown;
  variantInvites?: unknown;
  generatedAt?: unknown;
};

const STATUS_VALUES: TrainerInviteStatus[] = ['PENDING', 'CONFIRMED', 'DECLINED'];

function isValidStatus(value: unknown): value is TrainerInviteStatus {
  if (typeof value !== 'string') return false;
  return STATUS_VALUES.includes(value.trim().toUpperCase() as TrainerInviteStatus);
}

function isValidPipeline(value: unknown): value is SessionPipelineType {
  return value === 'FORMACION_EMPRESA' || value === 'GEP_SERVICES';
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = toStringValue(value);
  return normalized ?? null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeSessionInvite(row: any): SessionConfirmationRow {
  if (!row || typeof row !== 'object') {
    throw new ApiError('INVALID_RESPONSE', 'Formato de confirmación de sesión no válido');
  }
  const inviteId = toStringValue((row as any).inviteId ?? (row as any).id);
  const sessionId = toStringValue((row as any).sessionId ?? (row as any).sesionId);
  const pipelineType = (row as any).pipelineType;
  const status = (row as any).status;

  if (!inviteId) {
    throw new ApiError('INVALID_RESPONSE', 'Confirmación de sesión sin identificador');
  }
  if (!sessionId) {
    throw new ApiError('INVALID_RESPONSE', 'Confirmación de sesión sin sesión asociada');
  }
  if (!isValidPipeline(pipelineType)) {
    throw new ApiError('INVALID_RESPONSE', 'Confirmación de sesión sin pipeline válido');
  }
  if (!isValidStatus(status)) {
    throw new ApiError('INVALID_RESPONSE', 'Estado de confirmación de sesión desconocido');
  }

  return {
    inviteId,
    sessionId,
    dealId: normalizeNullableString(row.dealId),
    sessionTitle: normalizeNullableString(row.sessionTitle),
    productName: normalizeNullableString(row.productName),
    pipelineLabel: normalizeNullableString(row.pipelineLabel),
    pipelineType,
    trainerId: normalizeNullableString(row.trainerId),
    trainerName: normalizeNullableString(row.trainerName),
    trainerEmail: normalizeNullableString(row.trainerEmail),
    status: status.toUpperCase() as TrainerInviteStatus,
    startDate: normalizeDate(row.startDate),
    sentAt: normalizeDate(row.sentAt),
    respondedAt: normalizeDate(row.respondedAt),
  };
}

function normalizeVariantInvite(row: any): VariantConfirmationRow {
  if (!row || typeof row !== 'object') {
    throw new ApiError('INVALID_RESPONSE', 'Formato de confirmación de variante no válido');
  }
  const inviteId = toStringValue((row as any).inviteId ?? (row as any).id);
  if (!inviteId) {
    throw new ApiError('INVALID_RESPONSE', 'Confirmación de variante sin identificador');
  }
  const status = (row as any).status;
  if (!isValidStatus(status)) {
    throw new ApiError('INVALID_RESPONSE', 'Estado de confirmación de variante desconocido');
  }
  return {
    inviteId,
    variantId: normalizeNullableString(row.variantId),
    variantName: normalizeNullableString(row.variantName),
    productName: normalizeNullableString(row.productName),
    site: normalizeNullableString(row.site),
    date: normalizeDate(row.date),
    trainerId: normalizeNullableString(row.trainerId),
    trainerName: normalizeNullableString(row.trainerName),
    trainerEmail: normalizeNullableString(row.trainerEmail),
    status: status.toUpperCase() as TrainerInviteStatus,
    sentAt: normalizeDate(row.sentAt),
    respondedAt: normalizeDate(row.respondedAt),
  };
}

export async function fetchResourcesConfirmations(): Promise<ResourcesConfirmationsResponse> {
  const data = await requestJson<ResourcesConfirmationsApiResponse>('resources-confirmations');
  const sessionInvitesRaw = Array.isArray(data.sessionInvites) ? data.sessionInvites : [];
  const variantInvitesRaw = Array.isArray(data.variantInvites) ? data.variantInvites : [];

  return {
    sessionInvites: sessionInvitesRaw.map((row) => normalizeSessionInvite(row)),
    variantInvites: variantInvitesRaw.map((row) => normalizeVariantInvite(row)),
    generatedAt: normalizeDate(data.generatedAt),
  };
}
