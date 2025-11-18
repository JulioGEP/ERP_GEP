import { ApiError, requestJson } from '../../api/client';
import type {
  DealTag,
  ProductDefaults,
  ProductDefaultsUpdatePayload,
  ProductInfo,
  VariantInfo,
  VariantUpdatePayload,
} from './types';
import {
  normalizeDealTag,
  normalizeProductDefaults,
  normalizeProductFromResponse,
  normalizeVariantFromResponse,
} from './utils';

export type ProductsVariantsResponse = {
  ok?: boolean;
  products?: unknown;
  message?: string;
};

export type ProductDefaultsUpdateResponse = {
  ok?: boolean;
  product?: unknown;
  message?: string;
};

export type VariantBulkCreateResponse = {
  ok?: boolean;
  created?: unknown;
  skipped?: number;
  message?: string;
};

export type DeleteVariantResponse = {
  ok?: boolean;
  message?: string;
  error_code?: string;
};

export type VariantUpdateResponse = {
  ok?: boolean;
  variant?: unknown;
  message?: string;
};

export type DealsByVariationResponse = {
  ok?: boolean;
  deals?: unknown;
  message?: string;
};

export type SendVariantTrainerInvitesResponse = {
  variant?: unknown;
  invites?: unknown;
  skippedTrainers?: unknown;
  message?: string;
};

export type VariantTrainerInviteResponse = {
  invite?: unknown;
  message?: string;
};

export type VariantTrainerInvitesFetchResponse = {
  invites?: unknown;
  message?: string;
};

export type SendVariantTrainerInvitesResult = {
  variant: {
    id: string;
    name: string | null;
    product_name: string | null;
    product_code: string | null;
    sede: string | null;
    start_at: string | null;
    end_at: string | null;
  };
  invites: Array<{ trainerId: string; email: string; name: string; token: string; status: 'SENT' | 'FAILED' }>;
  skippedTrainers: Array<{ trainer_id: string; name: string | null; apellido: string | null }>;
};

export type VariantTrainerInvite = {
  token: string;
  status: 'PENDING' | 'CONFIRMED' | 'DECLINED';
  sent_at: string | null;
  responded_at: string | null;
  created_by: {
    user_id: string | null;
    name: string | null;
    email: string | null;
  };
  trainer: {
    id: string;
    name: string | null;
    last_name: string | null;
    email: string | null;
  };
  variant: {
    id: string;
    name: string | null;
    product_name: string | null;
    product_code: string | null;
    sede: string | null;
    start_at: string | null;
    end_at: string | null;
  };
};

export type VariantTrainerInviteSummary = {
  trainer_id: string;
  status: VariantTrainerInvite['status'];
  sent_at: string | null;
  responded_at: string | null;
};

function apiPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export async function fetchProductsWithVariants(): Promise<ProductInfo[]> {
  const json = await requestJson<ProductsVariantsResponse>(
    apiPath('products-variants'),
    { headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudieron obtener las variantes.' },
  );

  const products = Array.isArray(json.products) ? json.products : [];
  return products.map((product) => normalizeProductFromResponse(product));
}

export async function deleteProductVariant(variantId: string): Promise<string | null> {
  const json = await requestJson<DeleteVariantResponse>(
    apiPath(`products-variants/${encodeURIComponent(variantId)}`),
    { method: 'DELETE', headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudo eliminar la variante.' },
  );

  return typeof json.message === 'string' ? json.message : null;
}

export async function updateProductVariantDefaults(
  productId: string,
  updates: ProductDefaultsUpdatePayload,
): Promise<ProductDefaults> {
  const json = await requestJson<ProductDefaultsUpdateResponse>(
    apiPath('product-variant-settings'),
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product_id: productId, ...updates }),
    },
    { defaultErrorMessage: 'No se pudo actualizar la configuración del producto.' },
  );

  if (!json.product) {
    throw new ApiError('UPDATE_DEFAULTS_ERROR', 'No se pudo actualizar la configuración del producto.');
  }

  return normalizeProductDefaults(json.product);
}

export async function createProductVariantsForProduct(
  productId: string,
  sedes: string[],
  dates: string[],
): Promise<{ created: VariantInfo[]; skipped: number; message: string | null }> {
  const json = await requestJson<VariantBulkCreateResponse>(
    apiPath('product-variants-create'),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product_id: productId, sedes, dates }),
    },
    { defaultErrorMessage: 'No se pudieron crear las variantes.' },
  );

  const createdRaw = Array.isArray(json.created) ? json.created : [];
  const created = createdRaw.map((item, index) =>
    normalizeVariantFromResponse(item, `${productId}-new-${index}`),
  );

  return {
    created,
    skipped: typeof json.skipped === 'number' ? json.skipped : 0,
    message: typeof json.message === 'string' ? json.message : null,
  };
}

export async function updateProductVariant(
  variantId: string,
  updates: VariantUpdatePayload,
): Promise<VariantInfo> {
  const json = await requestJson<VariantUpdateResponse>(
    apiPath(`products-variants/${encodeURIComponent(variantId)}`),
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    },
    { defaultErrorMessage: 'No se pudo actualizar la variante.' },
  );

  if (!json.variant) {
    throw new ApiError('UPDATE_ERROR', 'No se pudo actualizar la variante.');
  }

  return normalizeVariantFromResponse(json.variant, variantId);
}

export async function fetchDealsByVariation(variationWooId: string): Promise<DealTag[]> {
  const json = await requestJson<DealsByVariationResponse>(
    apiPath(`deals?w_id_variation=${encodeURIComponent(variationWooId)}`),
    { headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudieron obtener los deals.' },
  );

  const deals = Array.isArray(json.deals) ? json.deals : [];
  return deals
    .map((deal) => normalizeDealTag(deal))
    .filter((deal): deal is DealTag => deal !== null);
}

function toTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toInviteStatus(value: unknown): VariantTrainerInvite['status'] {
  if (typeof value !== 'string') return 'PENDING';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'CONFIRMED' || normalized === 'DECLINED' || normalized === 'PENDING') {
    return normalized as VariantTrainerInvite['status'];
  }
  return 'PENDING';
}

function normalizeVariantTrainerInviteRecord(
  raw: unknown,
  fallbackToken: string,
): VariantTrainerInvite {
  const inviteRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const createdByRaw =
    inviteRaw.created_by && typeof inviteRaw.created_by === 'object'
      ? (inviteRaw.created_by as Record<string, unknown>)
      : {};
  const trainerRaw =
    inviteRaw.trainer && typeof inviteRaw.trainer === 'object'
      ? (inviteRaw.trainer as Record<string, unknown>)
      : {};
  const variantRaw =
    inviteRaw.variant && typeof inviteRaw.variant === 'object'
      ? (inviteRaw.variant as Record<string, unknown>)
      : {};

  return {
    token: toTrimmed(inviteRaw.token) ?? fallbackToken,
    status: toInviteStatus(inviteRaw.status),
    sent_at: typeof inviteRaw.sent_at === 'string' ? inviteRaw.sent_at : null,
    responded_at: typeof inviteRaw.responded_at === 'string' ? inviteRaw.responded_at : null,
    created_by: {
      user_id: toTrimmed((createdByRaw.user_id as any) ?? inviteRaw.created_by_user_id),
      name:
        typeof createdByRaw.name === 'string'
          ? createdByRaw.name
          : typeof inviteRaw.created_by_name === 'string'
          ? inviteRaw.created_by_name
          : null,
      email:
        typeof createdByRaw.email === 'string'
          ? createdByRaw.email
          : typeof inviteRaw.created_by_email === 'string'
          ? inviteRaw.created_by_email
          : null,
    },
    trainer: {
      id: toTrimmed((trainerRaw.id as any) ?? inviteRaw.trainer_id) ?? '',
      name:
        typeof trainerRaw.name === 'string'
          ? trainerRaw.name
          : typeof inviteRaw.trainer_name === 'string'
          ? inviteRaw.trainer_name
          : null,
      last_name:
        typeof trainerRaw.last_name === 'string'
          ? trainerRaw.last_name
          : typeof inviteRaw.trainer_last_name === 'string'
          ? inviteRaw.trainer_last_name
          : null,
      email:
        typeof trainerRaw.email === 'string'
          ? trainerRaw.email
          : typeof inviteRaw.trainer_email === 'string'
          ? inviteRaw.trainer_email
          : null,
    },
    variant: {
      id: toTrimmed((variantRaw.id as any) ?? inviteRaw.variant_id) ?? '',
      name: typeof variantRaw.name === 'string' ? variantRaw.name : null,
      product_name:
        typeof variantRaw.product_name === 'string' ? variantRaw.product_name : null,
      product_code:
        typeof variantRaw.product_code === 'string' ? variantRaw.product_code : null,
      sede: typeof variantRaw.sede === 'string' ? variantRaw.sede : null,
      start_at: typeof variantRaw.start_at === 'string' ? variantRaw.start_at : null,
      end_at: typeof variantRaw.end_at === 'string' ? variantRaw.end_at : null,
    },
  } satisfies VariantTrainerInvite;
}

export async function sendVariantTrainerInvites(variantId: string): Promise<SendVariantTrainerInvitesResult> {
  const normalizedId = String(variantId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'variantId es obligatorio');
  }

  const data = await requestJson<SendVariantTrainerInvitesResponse>(
    apiPath('variant-trainer-invites'),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ variantId: normalizedId }),
    },
    { defaultErrorMessage: 'No se pudieron enviar las invitaciones.' },
  );

  const variantRaw = data?.variant && typeof data.variant === 'object' ? (data.variant as Record<string, unknown>) : {};
  const variant = {
    id: toTrimmed(variantRaw.id) ?? normalizedId,
    name: typeof variantRaw.name === 'string' ? variantRaw.name : null,
    product_name: typeof variantRaw.product_name === 'string' ? variantRaw.product_name : null,
    product_code: typeof variantRaw.product_code === 'string' ? variantRaw.product_code : null,
    sede: typeof variantRaw.sede === 'string' ? variantRaw.sede : null,
    start_at: typeof variantRaw.start_at === 'string' ? variantRaw.start_at : null,
    end_at: typeof variantRaw.end_at === 'string' ? variantRaw.end_at : null,
  } satisfies SendVariantTrainerInvitesResult['variant'];

  const invitesRaw = Array.isArray(data?.invites) ? (data.invites as unknown[]) : [];
  const invites: SendVariantTrainerInvitesResult['invites'] = invitesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const trainerId = toTrimmed(record.trainerId) ?? toTrimmed(record.trainer_id);
      const email = typeof record.email === 'string' ? record.email : '';
      const name = typeof record.name === 'string' ? record.name : trainerId ?? '';
      const token = toTrimmed(record.token) ?? null;
      const statusRaw = typeof record.status === 'string' ? record.status.trim().toUpperCase() : '';
      const status = statusRaw === 'FAILED' ? 'FAILED' : statusRaw === 'SENT' ? 'SENT' : null;
      if (!trainerId || !token || !status) return null;
      return { trainerId, email, name, token, status };
    })
    .filter((entry): entry is SendVariantTrainerInvitesResult['invites'][number] => entry !== null);

  const skippedRaw = Array.isArray(data?.skippedTrainers) ? (data.skippedTrainers as unknown[]) : [];
  const skippedTrainers: SendVariantTrainerInvitesResult['skippedTrainers'] = skippedRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const trainerId = toTrimmed(record.trainer_id);
      return {
        trainer_id: trainerId ?? '',
        name: typeof record.name === 'string' ? record.name : null,
        apellido: typeof record.apellido === 'string' ? record.apellido : null,
      };
    })
    .filter((entry): entry is SendVariantTrainerInvitesResult['skippedTrainers'][number] => entry !== null);

  return {
    variant,
    invites,
    skippedTrainers,
  };
}

export async function fetchVariantTrainerInvite(token: string): Promise<VariantTrainerInvite> {
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedToken) {
    throw new ApiError('VALIDATION_ERROR', 'token es obligatorio');
  }

  const data = await requestJson<VariantTrainerInviteResponse>(
    apiPath(`variant-trainer-invites/${encodeURIComponent(normalizedToken)}`),
    { headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudo cargar la invitación.' },
  );

  return normalizeVariantTrainerInviteRecord(data?.invite, normalizedToken);
}

export async function respondVariantTrainerInvite(
  token: string,
  action: 'confirm' | 'decline',
): Promise<VariantTrainerInvite> {
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedToken) {
    throw new ApiError('VALIDATION_ERROR', 'token es obligatorio');
  }
  const normalizedAction = action === 'confirm' || action === 'decline' ? action : '';
  if (!normalizedAction) {
    throw new ApiError('VALIDATION_ERROR', 'Acción inválida');
  }

  const data = await requestJson<VariantTrainerInviteResponse>(
    apiPath(`variant-trainer-invites/${encodeURIComponent(normalizedToken)}/respond`),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: normalizedAction }),
    },
    { defaultErrorMessage: 'No se pudo registrar la respuesta.' },
  );

  if (data?.invite) {
    return normalizeVariantTrainerInviteRecord(data.invite, normalizedToken);
  }

  return fetchVariantTrainerInvite(normalizedToken);
}

export async function fetchVariantTrainerInviteSummaries(
  variantId: string,
): Promise<VariantTrainerInviteSummary[]> {
  const normalizedId = String(variantId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'variantId es obligatorio');
  }

  const response = await requestJson<VariantTrainerInvitesFetchResponse>(
    apiPath(`variant-trainer-invites?variantId=${encodeURIComponent(normalizedId)}`),
    { headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudieron cargar las confirmaciones de formadores.' },
  );

  const invitesRaw = Array.isArray(response?.invites) ? (response.invites as unknown[]) : [];
  const invites: VariantTrainerInviteSummary[] = invitesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const trainerId = toTrimmed(record.trainer_id);
      if (!trainerId) {
        return null;
      }
      const status = toInviteStatus(record.status);
      const sentAt = typeof record.sent_at === 'string' ? record.sent_at : null;
      const respondedAt = typeof record.responded_at === 'string' ? record.responded_at : null;
      return { trainer_id: trainerId, status, sent_at: sentAt, responded_at: respondedAt };
    })
    .filter((entry): entry is VariantTrainerInviteSummary => entry !== null);

  return invites;
}
