import { requestJson } from '../../../api/client';
import {
  ApiError,
  normalizeMobileUnitOption,
  normalizeRoomOption,
  normalizeSession,
  normalizeSessionComment,
  normalizeSessionGroup,
  normalizeSessionPublicLink,
  normalizeTrainerOption,
  sanitizeStringArray,
  toNonNegativeInteger,
  toNumber,
  toStringArray,
  toStringValue,
} from './shared';
import type {
  CreateSessionCommentInput,
  DealSummary,
  Json,
  MobileUnitOption,
  ProductVariantOption,
  RoomOption,
  SessionAvailability,
  SessionComment,
  SessionDTO,
  SessionGroupDTO,
  SessionPublicLink,
  SessionCounts,
  TrainerOption,
  UpdateSessionCommentInput,
} from './types';

export async function generateSessionsFromDeal(dealId: string): Promise<number> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId es obligatorio');
  }
  const data = await requestJson<{ count?: unknown }>(`/sessions/generate-from-deal`, {
    method: 'POST',
    body: JSON.stringify({ dealId: normalizedId }),
  });
  const count = toNumber(data?.count);
  return count ?? 0;
}

export async function fetchDealSessions(
  dealId: string,
  options?: { productId?: string; page?: number; limit?: number },
): Promise<SessionGroupDTO[]> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId es obligatorio');
  }

  const params = new URLSearchParams({ dealId: normalizedId });
  if (options?.productId) params.set('productId', String(options.productId));
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));

  const data = await requestJson<{ groups?: unknown[] }>(`/sessions?${params.toString()}`);
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return groups.map((group: any) => normalizeSessionGroup(group));
}

export async function createSession(payload: {
  deal_id: string;
  deal_product_id: string;
  nombre_cache?: string;
  fecha_inicio_utc?: string | null;
  fecha_fin_utc?: string | null;
  sala_id?: string | null;
  direccion?: string | null;
  trainer_ids?: string[];
  unidad_movil_ids?: string[];
}): Promise<SessionDTO> {
  const body: Record<string, unknown> = {
    deal_id: String(payload.deal_id ?? '').trim(),
    deal_product_id: String(payload.deal_product_id ?? '').trim(),
  };

  if (!body.deal_id || !body.deal_product_id) {
    throw new ApiError('VALIDATION_ERROR', 'deal_id y deal_product_id son obligatorios');
  }

  if (payload.nombre_cache !== undefined) body.nombre_cache = payload.nombre_cache;
  if (payload.fecha_inicio_utc !== undefined) body.fecha_inicio_utc = payload.fecha_inicio_utc;
  if (payload.fecha_fin_utc !== undefined) body.fecha_fin_utc = payload.fecha_fin_utc;
  if (payload.sala_id !== undefined) body.sala_id = payload.sala_id;
  if (payload.direccion !== undefined) body.direccion = payload.direccion;
  const trainerIds = sanitizeStringArray(payload.trainer_ids);
  if (trainerIds !== undefined) body.trainer_ids = trainerIds;

  const unidadIds = sanitizeStringArray(payload.unidad_movil_ids);
  if (unidadIds !== undefined) body.unidad_movil_ids = unidadIds;

  const data = await requestJson<{ session?: unknown }>(`/sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return normalizeSession(data?.session ?? {});
}

export async function patchSession(
  sessionId: string,
  payload: Partial<{
    nombre_cache: string;
    fecha_inicio_utc: string | null;
    fecha_fin_utc: string | null;
    sala_id: string | null;
    direccion: string | null;
    trainer_ids: string[];
    unidad_movil_ids: string[];
    estado: string;
  }>,
): Promise<SessionDTO> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const body: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'nombre_cache')) {
    body.nombre_cache = payload.nombre_cache ?? '';
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'fecha_inicio_utc'))
    body.fecha_inicio_utc = payload.fecha_inicio_utc ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, 'fecha_fin_utc'))
    body.fecha_fin_utc = payload.fecha_fin_utc ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, 'sala_id')) body.sala_id = payload.sala_id ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, 'direccion')) body.direccion = payload.direccion ?? '';
  if (Object.prototype.hasOwnProperty.call(payload, 'trainer_ids')) {
    body.trainer_ids = sanitizeStringArray(payload.trainer_ids) ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'unidad_movil_ids')) {
    body.unidad_movil_ids = sanitizeStringArray(payload.unidad_movil_ids) ?? [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'estado')) {
    body.estado = payload.estado;
  }

  const data = await requestJson<{ session?: unknown }>(`/sessions/${encodeURIComponent(normalizedId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  return normalizeSession(data?.session ?? {});
}

export async function fetchSessionCounts(sessionId: string): Promise<SessionCounts> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const data = await requestJson<{ comentarios?: unknown; documentos?: unknown; alumnos?: unknown; tokens?: unknown }>(
    `/sessions/${encodeURIComponent(normalizedId)}/counts`,
  );

  return {
    comentarios: toNonNegativeInteger(data?.comentarios),
    documentos: toNonNegativeInteger(data?.documentos),
    alumnos: toNonNegativeInteger(data?.alumnos),
    tokens: toNonNegativeInteger(data?.tokens),
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  await requestJson(`/sessions/${encodeURIComponent(normalizedId)}`, { method: 'DELETE' });
}

export async function fetchActiveTrainers(): Promise<TrainerOption[]> {
  const data = await requestJson<{ trainers?: unknown[] }>(`/trainers`);
  const trainers = Array.isArray(data?.trainers) ? data.trainers : [];
  return trainers
    .map((trainer) => normalizeTrainerOption(trainer))
    .filter((trainer): trainer is TrainerOption => trainer !== null);
}

export async function fetchRoomsCatalog(): Promise<RoomOption[]> {
  const data = await requestJson<{ rooms?: unknown[] }>(`/rooms`);
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  return rooms
    .map((room) => normalizeRoomOption(room))
    .filter((room): room is RoomOption => room !== null);
}

export async function fetchMobileUnitsCatalog(): Promise<MobileUnitOption[]> {
  const data = await requestJson<{ units?: unknown[] }>(`/mobile-units`);
  const units = Array.isArray(data?.units) ? data.units : [];
  return units
    .map((unit) => normalizeMobileUnitOption(unit))
    .filter((unit): unit is MobileUnitOption => unit !== null);
}

export async function fetchProductVariants(options?: {
  productIds?: string[];
  variantWooIds?: string[];
}): Promise<ProductVariantOption[]> {
  const data = await requestJson<{ products?: unknown[] }>(`/products-variants`);
  const products = Array.isArray(data?.products) ? (data.products as unknown[]) : [];

  const allowedValues = Array.isArray(options?.productIds) ? options!.productIds : [];
  const allowedExact = new Set<string>();
  const allowedLower = new Set<string>();

  const allowedVariantValues = Array.isArray(options?.variantWooIds) ? options!.variantWooIds : [];
  const allowedVariantExact = new Set<string>();

  for (const value of allowedValues) {
    const text = toStringValue(value);
    if (!text) continue;
    allowedExact.add(text);
    allowedLower.add(text.toLocaleLowerCase('es'));
  }

  for (const value of allowedVariantValues) {
    const text = toStringValue(value);
    if (!text) continue;
    allowedVariantExact.add(text);
  }

  const variants: ProductVariantOption[] = [];

  for (const product of products) {
    const productId = toStringValue((product as any)?.id);
    if (!productId) continue;

    const productPipeId = toStringValue((product as any)?.id_pipe);
    const productName = toStringValue((product as any)?.name);
    const productWooId = toStringValue((product as any)?.id_woo);
    const productCode = toStringValue((product as any)?.code);

    const productVariants = Array.isArray((product as any)?.variants)
      ? ((product as any)?.variants as unknown[])
      : [];

    let matchesVariantFilter = false;
    const normalizedVariants: ProductVariantOption[] = [];

    for (const rawVariant of productVariants) {
      const variantId = toStringValue((rawVariant as any)?.id);
      if (!variantId) continue;

      const wooId = toStringValue((rawVariant as any)?.id_woo);
      if (wooId && allowedVariantExact.has(wooId)) {
        matchesVariantFilter = true;
      }

      const parentWooId = toStringValue((rawVariant as any)?.id_padre);
      const name = toStringValue((rawVariant as any)?.name);
      const date = toStringValue((rawVariant as any)?.date);
      const status = toStringValue((rawVariant as any)?.status);
      const sede = toStringValue((rawVariant as any)?.sede);

      normalizedVariants.push({
        productId,
        productPipeId,
        productWooId,
        productName,
        productCode,
        variantId,
        wooId,
        name,
        date,
        status,
        parentWooId,
        sede,
      });
    }

    const matchesExact =
      (productId && allowedExact.has(productId)) ||
      (productPipeId && allowedExact.has(productPipeId)) ||
      (productCode && allowedExact.has(productCode));
    const matchesText =
      (productName && allowedLower.has(productName.toLocaleLowerCase('es'))) ||
      (productCode && allowedLower.has(productCode.toLocaleLowerCase('es')));

    const shouldFilter =
      allowedExact.size > 0 || allowedLower.size > 0 || allowedVariantExact.size > 0;

    if (shouldFilter && !matchesExact && !matchesText && !matchesVariantFilter) {
      continue;
    }

    variants.push(...normalizedVariants);
  }

  return variants;
}

export type VariantSiblingOption = {
  id: string;
  wooId: string | null;
  parentWooId: string | null;
  name: string | null;
  date: string | null;
};

export type VariantSiblingsResponse = {
  parent: { id: string | null; wooId: string | null; name: string | null } | null;
  variants: VariantSiblingOption[];
};

export async function fetchVariantSiblings(params: {
  variantWooId?: string | null;
  parentWooId?: string | null;
}): Promise<VariantSiblingsResponse> {
  const searchParams = new URLSearchParams();
  const variantId = toStringValue(params.variantWooId);
  const parentId = toStringValue(params.parentWooId);

  if (variantId) {
    searchParams.set('variantWooId', variantId);
  }

  if (parentId) {
    searchParams.set('parentWooId', parentId);
  }

  if (!variantId && !parentId) {
    throw new Error('variantWooId o parentWooId requerido');
  }

  const url = searchParams.toString().length
    ? `/variant-siblings?${searchParams.toString()}`
    : `/variant-siblings`;

  const data = await requestJson<{ variants?: unknown[]; parent?: unknown }>(url);

  const rawVariants = Array.isArray(data?.variants) ? data.variants : [];
  const normalizedVariants = rawVariants
    .map<VariantSiblingOption | null>((variant: any) => {
      const id = toStringValue(variant?.id);
      const wooId = toStringValue(variant?.wooId ?? variant?.id_woo);
      const parentWooIdValue = toStringValue(variant?.parentWooId ?? variant?.parent_woo_id);
      const name = toStringValue(variant?.name);
      const date = toStringValue(variant?.date);

      if (!id) {
        return null;
      }

      return {
        id,
        wooId,
        parentWooId: parentWooIdValue,
        name,
        date,
      } satisfies VariantSiblingOption;
    })
    .filter((variant): variant is VariantSiblingOption => variant !== null);

  const parentRaw = data?.parent;
  const parent = parentRaw
    ? {
        id: toStringValue((parentRaw as any)?.id),
        wooId: toStringValue((parentRaw as any)?.wooId ?? (parentRaw as any)?.id_woo),
        name: toStringValue((parentRaw as any)?.name),
      }
    : null;

  return { parent, variants: normalizedVariants };
}

export async function fetchSessionAvailability(params: {
  start: string;
  end?: string;
  excludeSessionId?: string;
  excludeVariantId?: string;
}): Promise<SessionAvailability> {
  const searchParams = new URLSearchParams();
  searchParams.set('start', params.start);
  if (params.end) searchParams.set('end', params.end);
  if (params.excludeSessionId) searchParams.set('excludeSessionId', params.excludeSessionId);
  if (params.excludeVariantId) searchParams.set('excludeVariantId', params.excludeVariantId);

  const data = await requestJson<{ availability?: { trainers?: unknown; rooms?: unknown; units?: unknown } }>(
    `/sessions/availability?${searchParams.toString()}`,
  );
  const availability = data?.availability ?? {};

  return {
    trainers: toStringArray((availability as any).trainers),
    rooms: toStringArray((availability as any).rooms),
    units: toStringArray((availability as any).units),
  };
}

export async function fetchSessionComments(sessionId: string): Promise<SessionComment[]> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const data = await requestJson<{ comments?: unknown[] }>(
    `/session_comments/${encodeURIComponent(normalizedId)}`,
  );
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  return comments.map((comment: any) => normalizeSessionComment(comment));
}

export async function createSessionComment(
  sessionId: string,
  input: CreateSessionCommentInput,
  user?: { id: string; name?: string },
): Promise<SessionComment> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const trimmedContent = typeof input?.content === 'string' ? input.content.trim() : '';
  if (!trimmedContent.length) {
    throw new ApiError('VALIDATION_ERROR', 'content requerido');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const payload: Record<string, unknown> = { content: trimmedContent };
  if (typeof input?.compartir_formador === 'boolean') {
    payload.compartir_formador = input.compartir_formador;
  }

  const data = await requestJson<{ comment?: unknown }>(
    `/session_comments/${encodeURIComponent(normalizedId)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
  );

  return normalizeSessionComment(data?.comment ?? {});
}

export async function updateSessionComment(
  sessionId: string,
  commentId: string,
  input: UpdateSessionCommentInput,
  user?: { id: string; name?: string },
): Promise<SessionComment> {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedCommentId = String(commentId ?? '').trim();
  if (!normalizedSessionId || !normalizedCommentId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId y commentId son obligatorios');
  }

  const trimmedContent = typeof input?.content === 'string' ? input.content.trim() : undefined;
  if (trimmedContent !== undefined && !trimmedContent.length) {
    throw new ApiError('VALIDATION_ERROR', 'content requerido');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  const payload: Record<string, unknown> = {};
  if (trimmedContent !== undefined) {
    payload.content = trimmedContent;
  }
  if (typeof input?.compartir_formador === 'boolean') {
    payload.compartir_formador = input.compartir_formador;
  }

  if (!Object.keys(payload).length) {
    throw new ApiError('VALIDATION_ERROR', 'Nada que actualizar');
  }

  const data = await requestJson<{ comment?: unknown }>(
    `/session_comments/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedCommentId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    },
  );

  return normalizeSessionComment(data?.comment ?? {});
}

export async function deleteSessionComment(
  sessionId: string,
  commentId: string,
  user?: { id: string; name?: string },
): Promise<void> {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedCommentId = String(commentId ?? '').trim();
  if (!normalizedSessionId || !normalizedCommentId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId y commentId son obligatorios');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  await requestJson(
    `/session_comments/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedCommentId)}`,
    {
      method: 'DELETE',
      headers,
    },
  );
}

export async function fetchSessionPublicLink(
  dealId: string,
  sessionId: string,
): Promise<SessionPublicLink | null> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const params = new URLSearchParams({
    deal_id: normalizedDealId,
    sesion_id: normalizedSessionId,
  });

  const data = await requestJson<{ link?: unknown }>(`/session_public_links?${params.toString()}`);
  if (!data?.link) {
    return null;
  }
  return normalizeSessionPublicLink(data.link);
}

export async function createSessionPublicLink(
  dealId: string,
  sessionId: string,
  options?: { expiresAt?: string | null },
): Promise<SessionPublicLink> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const payload: Record<string, unknown> = {
    deal_id: normalizedDealId,
    sesion_id: normalizedSessionId,
  };
  if (options?.expiresAt !== undefined) payload.expires_at = options.expiresAt;

  const data = await requestJson<{ link?: unknown }>(`/session_public_links`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return normalizeSessionPublicLink(data?.link ?? {});
}

export async function deleteSessionPublicLink(
  dealId: string,
  sessionId: string,
  options?: { tokenId?: string | null; token?: string | null },
): Promise<void> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const params = new URLSearchParams({
    deal_id: normalizedDealId,
    sesion_id: normalizedSessionId,
  });

  const tokenId = String(options?.tokenId ?? '').trim();
  if (tokenId.length) {
    params.set('token_id', tokenId);
  }

  const tokenValue = String(options?.token ?? '').trim();
  if (tokenValue.length) {
    params.set('token', tokenValue);
  }

  await requestJson(`/session_public_links?${params.toString()}`, {
    method: 'DELETE',
  });
}
