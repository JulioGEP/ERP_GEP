import {
  ApiError,
  requestJson,
  sanitizeStringArray,
  toNonNegativeInteger,
  toNumber,
  toStringArray,
  toStringValue,
} from '../../../api/client';
import {
  normalizeSession,
  normalizeSessionComment,
  normalizeSessionGroup,
  normalizeSessionPublicLink,
} from './normalizers';
import type {
  CreateSessionCommentInput,
  SessionAvailability,
  SessionComment,
  SessionCounts,
  SessionDTO,
  SessionGroupDTO,
  SessionPublicLink,
  SessionEstado,
} from '../../../api/sessions.types';

async function request<T = any>(path: string, init?: RequestInit) {
  return requestJson<T>(path, init);
}

export async function generateSessionsFromDeal(dealId: string): Promise<number> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId es obligatorio');
  }
  const data = await request<{ count?: unknown }>(`/sessions/generate-from-deal`, {
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

  const data = await request<{ groups?: unknown[] }>(`/sessions?${params.toString()}`);
  const groups = Array.isArray(data?.groups) ? data.groups ?? [] : [];
  return groups.map((group: any) => normalizeSessionGroup(group));
}

export async function createSession(
  payload: {
    deal_id: string;
    deal_product_id: string;
    nombre_cache?: string;
    fecha_inicio_utc?: string | null;
    fecha_fin_utc?: string | null;
    sala_id?: string | null;
    direccion?: string | null;
    trainer_ids?: string[];
    unidad_movil_ids?: string[];
  },
): Promise<SessionDTO> {
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

  const data = await request<{ session?: unknown }>('/sessions', {
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
    estado: SessionEstado;
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

  const data = await request<{ session?: unknown }>(`/sessions/${encodeURIComponent(normalizedId)}`, {
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

  const data = await request<{ comentarios?: unknown; documentos?: unknown; alumnos?: unknown; tokens?: unknown }>(
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

  await request(`/sessions/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
  });
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

  const data = await request<{ availability?: { trainers?: unknown; rooms?: unknown; units?: unknown } }>(
    `/sessions/availability?${searchParams.toString()}`,
  );
  const availability = data?.availability ?? {};

  return {
    trainers: toStringArray(availability.trainers),
    rooms: toStringArray(availability.rooms),
    units: toStringArray(availability.units),
    availableTrainers: toStringArray((availability as any).availableTrainers),
  };
}

export async function fetchSessionComments(sessionId: string): Promise<SessionComment[]> {
  const normalizedId = String(sessionId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const data = await request<{ comments?: unknown[] }>(
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

  const data = await request<{ comment?: unknown }>(
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
  input: Partial<CreateSessionCommentInput>,
  user?: { id: string; name?: string },
): Promise<SessionComment> {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedCommentId = String(commentId ?? '').trim();
  if (!normalizedSessionId || !normalizedCommentId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId y commentId son obligatorios');
  }

  const trimmedContent =
    typeof input?.content === 'string' ? input.content.trim() : undefined;
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

  const data = await request<{ comment?: unknown }>(
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

  await request(
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

  const data = await request<{ link?: unknown }>(`/session_public_links?${params.toString()}`);
  if (!data?.link) return null;
  return normalizeSessionPublicLink(data.link);
}

export async function createSessionPublicLink(
  dealId: string,
  sessionId: string,
  options?: { regenerate?: boolean },
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
  if (options?.regenerate !== undefined) {
    payload.regenerate = options.regenerate;
  }

  const data = await request<{ link?: unknown }>('/session_public_links', {
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

  await request(`/session_public_links?${params.toString()}`, {
    method: 'DELETE',
  });
}
