import {
  MATERIAL_DEAL_STATUSES,
  type MaterialDealStatus,
} from '../../../types/deal';
import type {
  DealDetail,
  DealDetailViewModel,
  DealDocument,
  DealNote,
  DealProduct,
  DealSummary,
  DealSummarySession,
} from '../../../types/deal';
import {
  pickNonEmptyString,
  sanitizeStringArray,
  toNonNegativeInteger,
  toNumber,
  toStringValue,
} from '../../../api/client';
import {
  SESSION_ESTADOS,
  type ProductVariantOption,
  type PublicSessionInfo,
  type RoomOption,
  type SessionComment,
  type SessionDTO,
  type SessionDocument,
  type SessionGroupDTO,
  type SessionPublicLink,
  type SessionStudent,
  type SessionTrainerInviteStatus,
  type SessionTrainerInviteSummary,
  type TrainerOption,
  type SessionEstado,
  type MobileUnitOption,
} from '../../../api/sessions.types';

export type Json = any;

function isHttpUrl(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  try {
    const str = String(value);
    return /^https?:\/\//i.test(str);
  } catch {
    return false;
  }
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeMaterialKey(value: unknown): string {
  const label = toStringValue(value);
  if (!label) return '';
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MATERIAL_PIPELINE_KEYS = new Set(['material', 'materiales']);

function normalizeMaterialStatus(value: unknown): MaterialDealStatus | null {
  const normalized = normalizeMaterialKey(value);
  if (!normalized) return null;

  for (const status of MATERIAL_DEAL_STATUSES) {
    if (normalizeMaterialKey(status) === normalized) {
      return status;
    }
  }

  return null;
}

function toSiNoLabel(value: unknown): DealDetail['transporte'] {
  const v = toStringValue(value)?.trim().toLowerCase();
  if (!v) return null;
  if (v === 'si' || v === 'sí') return 'Si';
  if (v === 'no') return 'No';
  return null;
}

function toSessionEstadoValue(value: unknown): SessionEstado {
  const text = toStringValue(value);
  if (!text) return 'BORRADOR';
  const normalized = text.toUpperCase();
  return SESSION_ESTADOS.includes(normalized as SessionEstado)
    ? (normalized as SessionEstado)
    : 'BORRADOR';
}

function toSessionTrainerInviteStatus(value: unknown): SessionTrainerInviteStatus {
  const text = toStringValue(value);
  if (!text) return 'NOT_SENT';
  const normalized = text.toUpperCase();
  return normalized === 'NOT_SENT' || normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED'
    ? (normalized as SessionTrainerInviteStatus)
    : 'NOT_SENT';
}

function normalizeTrainerInviteStatus(
  raw: unknown,
): SessionTrainerInviteSummary['status'] {
  const value = (toStringValue(raw) ?? '').trim().toUpperCase();
  if (value === 'CONFIRMED' || value === 'DECLINED') {
    return value;
  }
  return 'PENDING';
}

function buildPersonFullName(person?: {
  first_name?: string | null;
  last_name?: string | null;
} | null): string | null {
  if (!person) return null;
  const parts = [person.first_name, person.last_name]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  return parts.length ? parts.join(' ') : null;
}

export function normalizeProducts(
  raw: unknown,
): { products?: DealProduct[]; productNames?: string[] } {
  if (!raw) return {};

  const entries = Array.isArray(raw) ? raw : [];
  if (!entries.length) return {};

  const products: DealProduct[] = [];
  const names: string[] = [];

  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      const item = entry as Record<string, any>;

      const product: DealProduct = {
        id: item.id ?? null,
        deal_id: item.deal_id ?? null,
        id_pipe: toStringValue(item.id_pipe ?? item.product?.id_pipe ?? item.products?.id_pipe) ?? null,
        name: toStringValue(item.name) ?? null,
        code: toStringValue(item.code) ?? null,
        quantity: toNumber(item.quantity),
        price: toNumber(item.price),
        type: item.type ?? null,
        hours: typeof item.hours === 'number' ? item.hours : toNumber(item.hours) ?? null,
        comments: toStringValue(item.product_comments ?? item.comments),
        typeLabel: toStringValue(item.typeLabel),
        categoryLabel: toStringValue(item.categoryLabel),
        template: toStringValue(item.template) ?? null,
      };

      const rawProductStock =
        item.product_stock ?? item.product?.product_stock ?? item.products?.product_stock;

      const hasProductStockField =
        Object.prototype.hasOwnProperty.call(item, 'product_stock') ||
        Object.prototype.hasOwnProperty.call(item.product ?? {}, 'product_stock') ||
        Object.prototype.hasOwnProperty.call(item.products ?? {}, 'product_stock');

      if (hasProductStockField) {
        product.product_stock =
          typeof rawProductStock === 'number'
            ? rawProductStock
            : typeof rawProductStock === 'string'
            ? toNumber(rawProductStock)
            : toNumber(rawProductStock ?? null);
      }

      products.push(product);

      const label = toStringValue(product.name ?? product.code);
      if (label) names.push(label);
    } else {
      const label = toStringValue(entry);
      if (label) names.push(label);
    }
  }

  const result: { products?: DealProduct[]; productNames?: string[] } = {};
  if (products.length) result.products = products;
  if (names.length) result.productNames = names;
  return result;
}

export function normalizeDealSummarySession(raw: Json): DealSummarySession | null {
  if (!raw || typeof raw !== 'object') {
    const date = toStringValue(raw);
    if (!date) {
      return null;
    }
    return {
      id: null,
      fecha_inicio_utc: date,
      fecha: date,
      estado: null,
    };
  }

  const session = raw as Record<string, unknown>;
  const id = toStringValue(session.id);
  const startDate = toStringValue(session.fecha_inicio_utc);
  const endDate = toStringValue(session.fecha_fin_utc);
  const fallbackDate = toStringValue((session as any).fecha);
  const estadoRaw = toStringValue((session as any).estado);
  const estado = estadoRaw ? toSessionEstadoValue(estadoRaw) : null;
  const nombre_cache = toStringValue((session as any).nombre_cache ?? (session as any).nombre);
  const nombre = toStringValue((session as any).nombre);

  const trainerIdsSet = new Set<string>();
  const registerTrainerId = (value: unknown) => {
    const normalized = toStringValue(value);
    if (normalized) {
      trainerIdsSet.add(normalized);
    }
  };

  const firefighterIdsSet = new Set<string>();
  const registerFirefighterId = (value: unknown) => {
    const normalized = toStringValue(value);
    if (normalized) {
      firefighterIdsSet.add(normalized);
    }
  };

  const collectFirefighterId = (value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectFirefighterId(item));
      return;
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      registerFirefighterId(
        record.trainer_id ??
          record.trainerId ??
          record.bombero_id ??
          record.bomberoId ??
          record.firefighter_id ??
          record.firefighterId ??
          record.id,
      );
      return;
    }

    registerFirefighterId(value);
  };

  registerTrainerId((session as any).trainer_id ?? (session as any).trainerId);

  const rawTrainerIds = (session as any).trainer_ids ?? (session as any).trainerIds;
  if (Array.isArray(rawTrainerIds)) {
    rawTrainerIds.forEach((value) => registerTrainerId(value));
  }

  collectFirefighterId((session as any).bombero_id ?? (session as any).firefighter_id);

  const rawFirefighterIds =
    (session as any).bombero_ids ?? (session as any).firefighter_ids ?? (session as any).bomberos ?? (session as any).firefighters;
  if (rawFirefighterIds !== undefined) {
    collectFirefighterId(rawFirefighterIds);
  }

  const trainers = (session as any).trainers;
  if (Array.isArray(trainers)) {
    trainers.forEach((trainer) => {
      if (trainer && typeof trainer === 'object') {
        registerTrainerId((trainer as any).trainer_id ?? (trainer as any).trainerId ?? (trainer as any).id);
      } else {
        registerTrainerId(trainer);
      }
    });
  }

  const trainerRecord = (session as any).trainer;
  if (trainerRecord) {
    if (typeof trainerRecord === 'object') {
      registerTrainerId(
        (trainerRecord as any).trainer_id ?? (trainerRecord as any).trainerId ?? (trainerRecord as any).id,
      );
    } else {
      registerTrainerId(trainerRecord);
    }
  }

  Object.entries(session).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes('bombero') || normalizedKey.includes('firefighter')) {
      collectFirefighterId(value);
    }
  });

  const trainerIds = sanitizeStringArray(Array.from(trainerIdsSet)) ?? null;
  const trainer_id = toStringValue(
    (session as any).trainer_id ?? (session as any).trainerId ?? (trainerIds ? trainerIds[0] : null),
  );

  const firefighterIds = sanitizeStringArray(Array.from(firefighterIdsSet)) ?? null;
  const firefighterId = toStringValue(
    (session as any).firefighter_id ??
      (session as any).bombero_id ??
      (session as any).firefighterId ??
      (session as any).bomberoId ??
      (firefighterIds ? firefighterIds[0] : null),
  );

  if (!id && !startDate && !fallbackDate) {
    return null;
  }

  return {
    id: id ?? null,
    fecha_inicio_utc: startDate ?? fallbackDate ?? null,
    fecha_fin_utc: endDate ?? null,
    fecha: fallbackDate ?? (startDate ?? null),
    estado,
    nombre_cache,
    nombre,
    trainer_ids: trainerIds,
    trainer_id: trainer_id ?? null,
    firefighter_ids: firefighterIds,
    firefighter_id: firefighterId ?? null,
    bombero_ids: firefighterIds,
    bombero_id: firefighterId ?? null,
  };
}

function normalizeDealStudentNames(raw: Json): string[] {
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : [];
  if (!entries.length) return [];

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      const label = toStringValue(entry);
      if (label) names.push(label);
      continue;
    }

    const record = entry as Record<string, unknown>;
    const nombre = toStringValue(record['nombre']) ?? '';
    const apellido = toStringValue(record['apellido']) ?? '';
    const dni = toStringValue(record['dni']) ?? '';

    const combined = `${nombre} ${apellido}`.trim();
    if (combined.length) {
      names.push(combined);
      continue;
    }

    if (dni.length) {
      names.push(dni);
    }
  }

  return names;
}

export function normalizeDealSummary(row: Json): DealSummary {
  const rawDealId = row?.deal_id ?? row?.dealId ?? row?.id;
  const resolvedDealId =
    toStringValue(rawDealId) ?? (rawDealId != null ? String(rawDealId) : '');

  const title =
    toStringValue(row?.title ?? row?.deal_title) ??
    (resolvedDealId ? `Presupuesto #${resolvedDealId}` : 'Presupuesto');

  const organization =
    row?.organization || row?.organizations
      ? {
          name:
            toStringValue(
              row?.organization?.name ?? row?.organizations?.name,
            ) ?? null,
          org_id:
            toStringValue(
              row?.organization?.org_id ?? row?.organizations?.org_id,
            ) ?? null,
        }
      : undefined;

  const person = row?.person
    ? {
        person_id: row.person.person_id ?? null,
        first_name: row.person.first_name ?? null,
        last_name: row.person.last_name ?? null,
        email: row.person.email ?? null,
        phone: row.person.phone ?? null,
      }
    : undefined;

  const products = normalizeProducts(row?.products ?? row?.line_items ?? []);
  const pipelineLabel = toStringValue(row?.pipeline_label ?? row?.pipelineLabel);

  const isMaterialPipeline =
    MATERIAL_PIPELINE_KEYS.has(normalizeMaterialKey(pipelineLabel)) ||
    MATERIAL_PIPELINE_KEYS.has(normalizeMaterialKey(row?.pipeline_id));

  const estadoMaterialRaw = row?.estado_material ?? (row as any)?.deals?.estado_material;
  const estadoMaterial =
    normalizeMaterialStatus(estadoMaterialRaw) || (isMaterialPipeline ? 'Pedidos confirmados' : null);

  const rawSessions = Array.isArray(row?.sessions)
    ? row.sessions
    : Array.isArray(row?.sesiones)
    ? row.sesiones
    : [];

  const sessions = (rawSessions as unknown[])
    .map((session) => normalizeDealSummarySession(session))
    .filter((session): session is DealSummarySession => session !== null);

  const studentNames = normalizeDealStudentNames(row?.students ?? null);

  return {
    deal_id: resolvedDealId,
    dealId: resolvedDealId,
    title,
    organization,
    person,
    pipeline_id: toStringValue(row?.pipeline_id) ?? null,
    pipeline_label: pipelineLabel ?? null,
    estado_material: estadoMaterial,
    training_address: toStringValue(row?.training_address) ?? null,
    products: products.products,
    productNames: products.productNames,
    sessions,
    w_id_variation: toStringValue(row?.w_id_variation) ?? null,
    sede_label: toStringValue(row?.sede_label) ?? null,
    caes_label: toStringValue(row?.caes_label) ?? null,
    caes_val: toBoolean(row?.caes_val),
    fundae_label: toStringValue(row?.fundae_label) ?? null,
    fundae_val: toBoolean(row?.fundae_val),
    hotel_label: toStringValue(row?.hotel_label) ?? null,
    hotel_val: toBoolean(row?.hotel_val),
    transporte: toSiNoLabel(row?.transporte),
    transporte_val: toBoolean(row?.transporte_val),
    po: toStringValue(row?.po) ?? null,
    po_val: toBoolean(row?.po_val),
    comercial: toStringValue(row?.comercial) ?? null,
    proveedor: toStringValue(row?.proveedor ?? (row as any)?.deals?.proveedor) ?? null,
    proveedores: toStringValue(row?.proveedores ?? (row as any)?.deals?.proveedores) ?? null,
    observaciones: toStringValue(row?.observaciones) ?? null,
    fecha_estimada_entrega_material:
      toStringValue(row?.fecha_estimada_entrega_material ?? (row as any)?.deals?.fecha_estimada_entrega_material) ??
      null,
    direccion_envio: toStringValue(row?.direccion_envio) ?? null,
    forma_pago_material: toStringValue(row?.forma_pago_material) ?? null,
    presu_holded: toStringValue(row?.presu_holded) ?? null,
    modo_reserva: toStringValue(row?.modo_reserva) ?? null,
    hours: toNumber(row?.hours),
    a_fecha: toStringValue(row?.a_fecha) ?? null,
    studentNames,
  } satisfies DealSummary;
}

export function normalizeDealDetail(raw: Json): DealDetail {
  const products = normalizeProducts(raw?.products ?? raw?.line_items ?? []);
  const pipelineId =
    toStringValue(
      raw?.pipeline_id ?? raw?.pipelineId ?? raw?.deal_pipeline_id ?? raw?.pipeline?.id,
    ) ?? null;
  const pipelineLabel =
    toStringValue(
      raw?.pipeline_label ?? raw?.pipelineLabel ?? raw?.pipeline?.label ?? raw?.pipeline?.name,
    ) ?? null;
  const trainingAddress =
    toStringValue(raw?.training_address ?? raw?.trainingAddress ?? raw?.training?.address) ?? null;

  const isMaterialPipeline =
    MATERIAL_PIPELINE_KEYS.has(normalizeMaterialKey(pipelineLabel)) ||
    MATERIAL_PIPELINE_KEYS.has(normalizeMaterialKey(pipelineId));

  const estadoMaterialRaw = raw?.estado_material ?? (raw as any)?.deals?.estado_material;
  const estadoMaterial =
    normalizeMaterialStatus(estadoMaterialRaw) || (isMaterialPipeline ? 'Pedidos confirmados' : null);

  const notesSource = Array.isArray(raw?.notes)
    ? (raw.notes as unknown[])
    : Array.isArray((raw as { deal_notes?: unknown })?.deal_notes)
    ? ((raw as { deal_notes?: unknown[] }).deal_notes as unknown[])
    : [];

  const documentsSource = Array.isArray(raw?.documents)
    ? (raw.documents as unknown[])
    : Array.isArray((raw as { deal_files?: unknown })?.deal_files)
    ? ((raw as { deal_files?: unknown[] }).deal_files as unknown[])
    : Array.isArray((raw as { dealFiles?: unknown })?.dealFiles)
    ? ((raw as { dealFiles?: unknown[] }).dealFiles as unknown[])
    : [];

  const normalized: DealDetail = {
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId ?? raw?.id) ?? '',
    title: toStringValue(raw?.title) ?? null,
    organization: raw?.organization
      ? {
          name: toStringValue(raw.organization.name) ?? null,
          org_id: toStringValue(raw.organization.org_id) ?? null,
        }
      : null,
    person: raw?.person
      ? {
          person_id: raw.person.person_id ?? null,
          first_name: raw.person.first_name ?? null,
          last_name: raw.person.last_name ?? null,
          email: raw.person.email ?? null,
          phone: raw.person.phone ?? null,
        }
      : null,
    products: products.products ?? [],
    hours: toNumber(raw?.hours),
    pipeline_label: pipelineLabel,
    pipeline_id: pipelineId,
    estado_material: estadoMaterial,
    training_address: trainingAddress,
    sede_label: toStringValue(raw?.sede_label) ?? null,
    caes_label: toStringValue(raw?.caes_label) ?? null,
    caes_val: toBoolean(raw?.caes_val),
    fundae_label: toStringValue(raw?.fundae_label) ?? null,
    fundae_val: toBoolean(raw?.fundae_val),
    hotel_label: toStringValue(raw?.hotel_label) ?? null,
    hotel_val: toBoolean(raw?.hotel_val),
    transporte: toSiNoLabel(raw?.transporte),
    transporte_val: toBoolean(raw?.transporte_val),
    po: toStringValue(raw?.po) ?? null,
    po_val: toBoolean(raw?.po_val),
    comercial: toStringValue(raw?.comercial) ?? null,
    w_id_variation: toStringValue(raw?.w_id_variation) ?? null,
    a_fecha: toStringValue(raw?.a_fecha) ?? null,
    proveedor: toStringValue(raw?.proveedor ?? (raw as any)?.deals?.proveedor) ?? null,
    proveedores: toStringValue(raw?.proveedores ?? (raw as any)?.deals?.proveedores) ?? null,
    observaciones: toStringValue(raw?.observaciones) ?? null,
    fecha_estimada_entrega_material:
      toStringValue(
        raw?.fecha_estimada_entrega_material ?? (raw as any)?.deals?.fecha_estimada_entrega_material,
      ) ?? null,
    direccion_envio: toStringValue(raw?.direccion_envio) ?? null,
    forma_pago_material: toStringValue(raw?.forma_pago_material) ?? null,
    modo_reserva: toStringValue(raw?.modo_reserva) ?? null,
    notes: notesSource.map((note) => normalizeDealNote(note)),
    documents: documentsSource.map((doc) => normalizeDealDocument(doc)),
    presu_holded: toStringValue(raw?.presu_holded) ?? null,
  };

  return normalized;
}

export function normalizeDealNote(raw: Json): DealNote {
  return {
    id: toStringValue(raw?.id) ?? '',
    content: normalizeNoteContent(toStringValue(raw?.content)),
    author: toStringValue(raw?.author),
    created_at: toStringValue(raw?.created_at),
  } as DealNote;
}

export function normalizeNoteContent(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length) return trimmed;
  return '';
}

export function normalizeDealDocument(raw: any): DealDocument {
  return {
    id: toStringValue(raw?.id) ?? '',
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId) ?? '',
    name: toStringValue(raw?.name ?? raw?.file_name ?? raw?.fileName) ?? null,
    mime_type: toStringValue(raw?.mime_type ?? raw?.file_type) ?? null,
    url: isHttpUrl(raw?.url) ? String(raw?.url) : null,
    source: toStringValue(raw?.source) ?? (raw?.drive_file_name || raw?.driveUrl ? 'PIPEDRIVE' : 'MANUAL'),
    size: typeof raw?.size === 'number' ? raw.size : null,
    compartir_formador: typeof raw?.compartir_formador === 'boolean' ? raw.compartir_formador : false,
    added_at: toStringValue(raw?.added_at) ?? null,
    updated_at: toStringValue(raw?.updated_at) ?? null,
    drive_file_name: toStringValue(raw?.drive_file_name) ?? null,
    drive_web_view_link:
      isHttpUrl(raw?.drive_web_view_link ?? raw?.driveUrl)
        ? String(raw?.drive_web_view_link ?? raw?.driveUrl)
        : null,
  } as DealDocument;
}

export function normalizeSession(row: any): SessionDTO {
  const invitesSource = Array.isArray(row?.trainer_invites)
    ? row.trainer_invites
    : Array.isArray(row?.trainerInvites)
    ? row.trainerInvites
    : [];
  return {
    id: toStringValue(row?.id) ?? '',
    deal_id: toStringValue(row?.deal_id ?? row?.dealId) ?? '',
    deal_product_id: toStringValue(row?.deal_product_id ?? row?.dealProductId) ?? '',
    nombre_cache: toStringValue(row?.nombre_cache ?? row?.nombre) ?? '',
    fecha_inicio_utc: toStringValue(row?.fecha_inicio_utc ?? row?.fechaInicioUtc) ?? null,
    fecha_fin_utc: toStringValue(row?.fecha_fin_utc ?? row?.fechaFinUtc) ?? null,
    sala_id: toStringValue(row?.sala_id ?? row?.salaId) ?? null,
    direccion: toStringValue(row?.direccion) ?? '',
    estado: toSessionEstadoValue(row?.estado),
    drive_url: toStringValue(row?.drive_url ?? row?.driveUrl) ?? null,
    updated_at: toStringValue(row?.updated_at ?? row?.updatedAt) ?? null,
    updated_by: toStringValue(row?.updated_by ?? row?.updatedBy) ?? null,
    trainer_ids: sanitizeStringArray(row?.trainer_ids) ?? [],
    unidad_movil_ids: sanitizeStringArray(row?.unidad_movil_ids) ?? [],
    trainer_invite_status: toSessionTrainerInviteStatus(row?.trainer_invite_status),
    trainer_invites: invitesSource.map((invite: any) => ({
      trainer_id: toStringValue(invite?.trainer_id ?? invite?.trainerId) ?? null,
      status: normalizeTrainerInviteStatus(invite?.status),
      sent_at: toStringValue(invite?.sent_at ?? invite?.sentAt) ?? null,
      responded_at: toStringValue(invite?.responded_at ?? invite?.respondedAt) ?? null,
    })),
  } satisfies SessionDTO;
}

export function normalizeSessionGroup(raw: any): SessionGroupDTO {
  const productRaw = raw?.product ?? {};
  return {
    product: {
      id: toStringValue(productRaw?.id) ?? '',
      code: toStringValue(productRaw?.code) ?? null,
      name: toStringValue(productRaw?.name) ?? null,
      quantity: toNumber(productRaw?.quantity) ?? 0,
    },
    sessions: ((Array.isArray(raw?.sessions)
      ? raw.sessions
      : Array.isArray(raw?.sesiones)
      ? raw.sesiones
      : []) as unknown[]).map((session) => normalizeSession(session)),
    pagination: {
      page: toNonNegativeInteger(raw?.pagination?.page),
      limit: toNonNegativeInteger(raw?.pagination?.limit) || 10,
      total: toNonNegativeInteger(raw?.pagination?.total),
      totalPages: toNonNegativeInteger(raw?.pagination?.totalPages),
    },
  } satisfies SessionGroupDTO;
}

export function normalizeSessionComment(raw: any): SessionComment {
  return {
    id: toStringValue(raw?.id) ?? '',
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId) ?? '',
    sesion_id: toStringValue(raw?.sesion_id ?? raw?.session_id ?? raw?.sessionId) ?? '',
    content: toStringValue(raw?.content) ?? '',
    author: toStringValue(raw?.author) ?? null,
    author_id: toStringValue(raw?.author_id ?? raw?.authorId) ?? null,
    compartir_formador:
      typeof raw?.compartir_formador === 'boolean' ? raw.compartir_formador : false,
    created_at: toStringValue(raw?.created_at) ?? null,
    updated_at: toStringValue(raw?.updated_at) ?? null,
  } satisfies SessionComment;
}

export function normalizeSessionDocument(raw: any): SessionDocument {
  return {
    id: toStringValue(raw?.id) ?? '',
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId) ?? '',
    sesion_id: toStringValue(raw?.sesion_id ?? raw?.session_id ?? raw?.sessionId) ?? '',
    file_type: toStringValue(raw?.file_type ?? raw?.mime_type) ?? null,
    compartir_formador:
      typeof raw?.compartir_formador === 'boolean' ? raw.compartir_formador : false,
    trainer_expense: Boolean(
      raw?.trainer_expense ?? raw?.trainerExpense ?? raw?.es_gasto_formador ?? raw?.gasto_formador,
    ),
    added_at: toStringValue(raw?.added_at) ?? null,
    updated_at: toStringValue(raw?.updated_at) ?? null,
    drive_file_name: toStringValue(raw?.drive_file_name) ?? null,
    drive_web_view_link:
      isHttpUrl(raw?.drive_web_view_link ?? raw?.driveUrl)
        ? String(raw?.drive_web_view_link ?? raw?.driveUrl)
        : null,
  } satisfies SessionDocument;
}

export function normalizeSessionStudent(raw: any): SessionStudent {
  return {
    id: toStringValue(raw?.id) ?? '',
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId) ?? '',
    sesion_id: toStringValue(raw?.sesion_id ?? raw?.session_id ?? raw?.sessionId) ?? '',
    nombre: toStringValue(raw?.nombre ?? raw?.name) ?? '',
    apellido: toStringValue(raw?.apellido ?? raw?.last_name ?? raw?.lastName) ?? '',
    dni: toStringValue(raw?.dni) ?? '',
    asistencia: Boolean(raw?.asistencia),
    apto: Boolean(raw?.apto),
    certificado: Boolean(raw?.certificado),
    drive_url: toStringValue(raw?.drive_url ?? raw?.driveUrl) ?? null,
    created_at: toStringValue(raw?.created_at) ?? null,
    updated_at: toStringValue(raw?.updated_at) ?? null,
  } satisfies SessionStudent;
}

export function normalizeSessionPublicLink(raw: any): SessionPublicLink {
  return {
    id: toStringValue(raw?.id) ?? '',
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId) ?? '',
    sesion_id: toStringValue(raw?.sesion_id ?? raw?.session_id ?? raw?.sessionId) ?? '',
    token: toStringValue(raw?.token) ?? '',
    public_path: toStringValue(raw?.public_path ?? raw?.publicPath) ?? null,
    public_url: toStringValue(raw?.public_url ?? raw?.publicUrl) ?? null,
    created_at: toStringValue(raw?.created_at) ?? null,
    updated_at: toStringValue(raw?.updated_at) ?? null,
    expires_at: toStringValue(raw?.expires_at) ?? null,
    revoked_at: toStringValue(raw?.revoked_at) ?? null,
    last_access_at: toStringValue(raw?.last_access_at) ?? null,
    last_access_ip: toStringValue(raw?.last_access_ip) ?? null,
    last_access_ua: toStringValue(raw?.last_access_ua) ?? null,
    active: Boolean(raw?.active ?? true),
    ip_created: toStringValue(raw?.ip_created) ?? null,
    user_agent: toStringValue(raw?.user_agent) ?? null,
  } satisfies SessionPublicLink;
}

export function normalizePublicSessionInfo(raw: any): PublicSessionInfo {
  return {
    deal_id: toStringValue(raw?.deal_id ?? raw?.dealId) ?? null,
    sesion_id: toStringValue(raw?.sesion_id ?? raw?.session_id ?? raw?.sessionId) ?? null,
    session_name: toStringValue(raw?.session_name ?? raw?.sessionName) ?? null,
    formation_name: toStringValue(raw?.formation_name ?? raw?.formationName) ?? null,
    title: toStringValue(raw?.title) ?? null,
    organization_name: toStringValue(raw?.organization_name ?? raw?.organizationName) ?? null,
    comercial: toStringValue(raw?.comercial ?? raw?.commercial_name ?? raw?.commercialName) ?? null,
    session_address: toStringValue(raw?.session_address ?? raw?.sessionAddress) ?? null,
  } satisfies PublicSessionInfo;
}

export function normalizeTrainerOption(raw: any): TrainerOption | null {
  const trainer_id = toStringValue(raw?.trainer_id ?? raw?.id ?? raw?.trainerId);
  if (!trainer_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return {
    trainer_id,
    name,
    apellido: toStringValue(raw?.apellido) ?? null,
    dni: toStringValue(raw?.dni) ?? null,
    activo: raw?.activo === undefined ? true : Boolean(raw.activo),
  } satisfies TrainerOption;
}

export function normalizeRoomOption(raw: any): RoomOption | null {
  const sala_id = toStringValue(raw?.sala_id ?? raw?.id ?? raw?.room_id);
  if (!sala_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return { sala_id, name, sede: toStringValue(raw?.sede) ?? null } satisfies RoomOption;
}

export function normalizeMobileUnitOption(raw: any): MobileUnitOption | null {
  const unidad_id = toStringValue(raw?.unidad_id ?? raw?.id ?? raw?.unit_id);
  if (!unidad_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return {
    unidad_id,
    name,
    matricula: toStringValue(raw?.matricula) ?? null,
    activo: raw?.activo === undefined ? true : Boolean(raw.activo),
  } satisfies MobileUnitOption;
}

export function resolveProducts(detail?: DealDetail | null, summary?: DealSummary | null): DealProduct[] {
  if (detail?.products?.length) return detail.products;
  if (summary?.products?.length) return summary.products;
  return [];
}

export function resolveProductName(detail?: DealDetail | null, summary?: DealSummary | null): string | null {
  const products = resolveProducts(detail, summary);
  for (const p of products) {
    const label = pickNonEmptyString(p?.name ?? null, p?.code ?? null);
    if (label) return label;
  }
  if (Array.isArray(summary?.productNames)) {
    const label = pickNonEmptyString(...summary!.productNames);
    if (label) return label;
  }
  return null;
}

export function buildDealDetailViewModel(
  detail?: DealDetail | null,
  summary?: DealSummary | null,
): DealDetailViewModel {
  const dealId = pickNonEmptyString(detail?.deal_id, summary?.deal_id, summary?.dealId);

  const title = pickNonEmptyString(detail?.title ?? null, summary?.title ?? null);
  const organizationName = pickNonEmptyString(
    detail?.organization?.name ?? null,
    summary?.organization?.name ?? null,
  );
  const person = detail?.person ?? summary?.person ?? null;
  const clientName = buildPersonFullName(person ?? null);
  const clientEmail = pickNonEmptyString(person?.email ?? null);
  const clientPhone = pickNonEmptyString(person?.phone ?? null);

  const pipelineLabel = pickNonEmptyString(
    detail?.pipeline_label ?? null,
    summary?.pipeline_label ?? null,
  );
  const trainingAddress = pickNonEmptyString(
    detail?.training_address ?? null,
    summary?.training_address ?? null,
  );

  const productName = resolveProductName(detail ?? null, summary ?? null);

  const hours = detail?.hours ?? summary?.hours ?? null;
  const sedeLabel = pickNonEmptyString(detail?.sede_label ?? null, summary?.sede_label ?? null);
  const caesLabel = pickNonEmptyString(detail?.caes_label ?? null, summary?.caes_label ?? null);
  const fundaeLabel = pickNonEmptyString(detail?.fundae_label ?? null, summary?.fundae_label ?? null);
  const hotelLabel = pickNonEmptyString(detail?.hotel_label ?? null, summary?.hotel_label ?? null);
  const comercial = pickNonEmptyString(detail?.comercial ?? null, summary?.comercial ?? null);
  const aFecha = pickNonEmptyString(detail?.a_fecha ?? null, summary?.a_fecha ?? null);
  const wIdVariation = pickNonEmptyString(
    detail?.w_id_variation ?? null,
    summary?.w_id_variation ?? null,
  );
  const presuHolded = pickNonEmptyString(
    detail?.presu_holded ?? null,
    summary?.presu_holded ?? null,
  );
  const modoReserva = pickNonEmptyString(detail?.modo_reserva ?? null, summary?.modo_reserva ?? null);

  return {
    dealId: dealId ?? '',
    title: title ?? null,
    organizationName: organizationName ?? null,
    clientName: clientName ?? null,
    clientEmail: clientEmail ?? null,
    clientPhone: clientPhone ?? null,
    pipelineLabel: pipelineLabel ?? null,
    trainingAddress: trainingAddress ?? null,
    productName: productName ?? null,
    hours,
    sedeLabel: sedeLabel ?? null,
    caesLabel: caesLabel ?? null,
    fundaeLabel: fundaeLabel ?? null,
    hotelLabel: hotelLabel ?? null,
    comercial: comercial ?? null,
    aFecha: aFecha ?? null,
    wIdVariation: wIdVariation ?? null,
    presuHolded,
    modoReserva: modoReserva ?? null,
    extras: undefined,
    products: resolveProducts(detail, summary),
    notes: (detail?.notes ?? []).map((n) => ({
      id: n?.id ?? null,
      content: normalizeNoteContent(n?.content ?? null),
      author: pickNonEmptyString(n?.author ?? null),
    })),
  } satisfies DealDetailViewModel;
}

export function normalizeProductVariants(
  products: unknown[],
  options?: { productIds?: string[]; variantWooIds?: string[] },
): ProductVariantOption[] {
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
      (productName && allowedLower.has(productName.toLocaleLowerCase('es')))
        || (productCode && allowedLower.has(productCode.toLocaleLowerCase('es')));

    const shouldFilter =
      allowedExact.size > 0 || allowedLower.size > 0 || allowedVariantExact.size > 0;

    if (shouldFilter && !matchesExact && !matchesText && !matchesVariantFilter) {
      continue;
    }

    variants.push(...normalizedVariants);
  }

  return variants;
}

export function normalizeVariantSibling(raw: any) {
  return {
    id: toStringValue(raw?.id) ?? '',
    wooId: toStringValue(raw?.wooId ?? raw?.id_woo) ?? null,
    parentWooId: toStringValue(raw?.parentWooId ?? raw?.parent_woo_id) ?? null,
    name: toStringValue(raw?.name) ?? null,
    date: toStringValue(raw?.date) ?? null,
  };
}

export function normalizeVariantParent(raw: any) {
  return raw
    ? {
        id: toStringValue(raw?.id) ?? null,
        wooId: toStringValue(raw?.wooId ?? raw?.id_woo) ?? null,
        name: toStringValue(raw?.name) ?? null,
      }
    : null;
}
