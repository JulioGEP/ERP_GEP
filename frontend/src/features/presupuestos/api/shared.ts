import {
  ApiError,
  blobToBase64,
  toStringArray,
  toStringValue,
} from '../../../api/client';
import {
  SESSION_ESTADOS,
  type CreateSessionCommentInput,
  type DealDetail,
  type DealDetailViewModel,
  type DealDocument,
  type DealNote,
  type DealProduct,
  type DealSummary,
  type DealSummarySession,
  type Json,
  type MobileUnitOption,
  type ProductVariantOption,
  type PublicSessionInfo,
  type RoomOption,
  type SessionAvailability,
  type SessionComment,
  type SessionDTO,
  type SessionDocument,
  type SessionGroupDTO,
  type SessionPublicLink,
  type SessionStudent,
  type SessionStudent as SessionStudentType,
  type TrainerOption,
} from './types';

export { ApiError, blobToBase64, toStringArray, toStringValue };

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toNonNegativeInteger(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function isHttpUrl(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  try {
    const str = String(value);
    return /^https?:\/\//i.test(str);
  } catch {
    return false;
  }
}

export function pickNonEmptyString(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
  }
  return null;
}

export function toSessionEstadoValue(value: unknown) {
  const text = toStringValue(value);
  if (!text) return 'BORRADOR' as const;
  const normalized = text.toUpperCase();
  return SESSION_ESTADOS.includes(normalized as any)
    ? (normalized as any)
    : ('BORRADOR' as const);
}

export function buildPersonFullName(person?: {
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
    };
  }

  const session = raw as Record<string, unknown>;
  const id = toStringValue(session.id);
  const startDate = toStringValue(session.fecha_inicio_utc);
  const fallbackDate = toStringValue((session as any).fecha);

  if (!id && !startDate && !fallbackDate) {
    return null;
  }

  return {
    id: id ?? null,
    fecha_inicio_utc: startDate ?? fallbackDate ?? null,
    fecha: fallbackDate ?? (startDate ?? null),
  };
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

  const productsInfo = normalizeProducts(row?.products ?? row?.deal_products);

  const rawSessions = Array.isArray(row?.sesiones)
    ? row?.sesiones
    : Array.isArray(row?.sessions)
    ? row?.sessions
    : [];
  const sessions = rawSessions
    .map((session: Json) => normalizeDealSummarySession(session))
    .filter((session): session is DealSummarySession => session !== null);

  const summary: DealSummary = {
    deal_id: resolvedDealId,
    dealId: resolvedDealId,
    title,

    pipeline_label: toStringValue(row?.pipeline_label) ?? null,
    pipeline_id:
      toStringValue(row?.pipeline_id) ??
      toStringValue(row?.deal_pipeline_id) ??
      null,
    training_address: toStringValue(row?.training_address) ?? null,

    sede_label: toStringValue(row?.sede_label) ?? null,
    caes_label: toStringValue(row?.caes_label) ?? null,
    fundae_label: toStringValue(row?.fundae_label) ?? null,
    hotel_label: toStringValue(row?.hotel_label) ?? null,
    tipo_servicio: toStringValue(row?.tipo_servicio) ?? null,
    mail_invoice: toStringValue(row?.mail_invoice) ?? null,
    comercial: toStringValue(row?.comercial) ?? null,
    a_fecha: toStringValue(row?.a_fecha) ?? null,
    w_id_variation: toStringValue(row?.w_id_variation) ?? null,
    presu_holded: toStringValue(row?.presu_holded) ?? null,
    modo_reserva: toStringValue(row?.modo_reserva) ?? null,

    hours: toNumber(row?.hours) ?? null,

    organization: organization ?? null,
    person: person ?? null,
  };

  if (productsInfo.products) summary.products = productsInfo.products;
  if (productsInfo.productNames) summary.productNames = productsInfo.productNames;
  if (sessions.length) summary.sessions = sessions;

  return summary;
}

export function normalizeDealDetail(raw: Json): DealDetail {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('INVALID_DEAL_DETAIL', 'Detalle del presupuesto no disponible');
  }

  const detailId = toStringValue(raw.deal_id ?? raw.id ?? raw.dealId);
  if (!detailId) {
    throw new ApiError('INVALID_DEAL_DETAIL', 'Detalle del presupuesto no disponible');
  }

  const detail: DealDetail = {
    deal_id: detailId,
    title: toStringValue(raw.title ?? raw.deal_title) ?? null,

    pipeline_label: toStringValue(raw.pipeline_label) ?? null,
    pipeline_id:
      toStringValue(raw.pipeline_id) ??
      toStringValue(raw.deal_pipeline_id) ??
      null,
    training_address:
      toStringValue(raw.training_address) ?? null,

    sede_label: toStringValue(raw.sede_label) ?? null,
    caes_label: toStringValue(raw.caes_label) ?? null,
    fundae_label: toStringValue(raw.fundae_label) ?? null,
    hotel_label: toStringValue(raw.hotel_label) ?? null,
    comercial: toStringValue(raw.comercial) ?? null,
    a_fecha: toStringValue(raw.a_fecha) ?? null,
    w_id_variation: toStringValue(raw.w_id_variation) ?? null,
    presu_holded: toStringValue(raw.presu_holded) ?? null,
    modo_reserva: toStringValue(raw.modo_reserva) ?? null,
    transporte:
      toStringValue(raw.transporte) === null
        ? null
        : (toStringValue(raw.transporte) as 'Si' | 'Sí' | 'No'),
    po: toStringValue(raw.po) ?? null,
    tipo_servicio: toStringValue(raw.tipo_servicio) ?? null,
    mail_invoice: toStringValue(raw.mail_invoice) ?? null,

    hours: toNumber(raw.hours) ?? null,

    organization: null,
    person: null,

    products: [],
    notes: [],
    documents: [],
  };

  const rawOrg = raw.organization ?? raw.organizations ?? null;
  if (rawOrg && (rawOrg.name || rawOrg.org_id)) {
    detail.organization = {
      name: toStringValue(rawOrg.name) ?? null,
      org_id: toStringValue(rawOrg.org_id) ?? null,
    };
  }

  const rawPerson = raw.person ?? null;
  if (rawPerson && (rawPerson.first_name || rawPerson.last_name)) {
    detail.person = {
      person_id: rawPerson.person_id ?? null,
      first_name: toStringValue(rawPerson.first_name) ?? null,
      last_name: toStringValue(rawPerson.last_name) ?? null,
      email: toStringValue(rawPerson.email) ?? null,
      phone: toStringValue(rawPerson.phone) ?? null,
    };
  }

  const productsInfo = normalizeProducts(raw.products);
  detail.products = productsInfo.products ?? [];

  const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];
  detail.notes = rawNotes.map((note) => normalizeDealNote(note)).filter(Boolean);

  const rawDocs = Array.isArray(raw.documents) ? raw.documents : [];
  detail.documents = rawDocs.map((doc) => normalizeDealDocument(doc));

  return detail;
}

export function normalizeDealNote(raw: Json): DealNote {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError('INVALID_DEAL_NOTE', 'Nota no disponible');
  }

  const id = toStringValue(raw?.id ?? raw?.note_id ?? null);
  const deal_id = toStringValue(raw?.deal_id ?? null);
  const contentValue = toStringValue(raw?.content ?? null);
  const author = toStringValue(raw?.author ?? null);
  const created_at = toStringValue(raw?.created_at ?? null);

  return {
    id,
    deal_id,
    content: contentValue,
    author,
    created_at,
  } as DealNote;
}

export function normalizeNoteContent(value: string | null): string {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return normalized;
}

export function normalizeDealDocument(raw: any): DealDocument {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sesionId = toStringValue(raw?.sesion_id) ?? '';
  const driveFileName = toStringValue(raw?.drive_file_name);
  const name = pickNonEmptyString(
    toStringValue(raw?.name),
    toStringValue(raw?.file_name)
  );
  const mime = toStringValue(raw?.mime_type ?? raw?.file_type);
  const driveWebViewLink = toStringValue(raw?.drive_web_view_link);
  const apiUrl = toStringValue(raw?.url);
  const fileUrl = toStringValue(isHttpUrl(raw?.file_url) ? raw?.file_url : null);
  const sourceValue = toStringValue(raw?.source);
  const createdAt = toStringValue(raw?.created_at ?? raw?.added_at);
  const updatedAt = toStringValue(raw?.updated_at);

  const url = fileUrl ?? apiUrl ?? driveWebViewLink ?? null;
  const drive_url = toStringValue(raw?.drive_url);

  return {
    id,
    deal_id: dealId,
    sesion_id: sesionId,
    file_type: mime ?? sourceValue ?? null,
    compartir_formador: Boolean(raw?.compartir_formador ?? raw?.share_with_trainer ?? false),
    added_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
    drive_file_name: driveFileName ?? (name ?? null),
    drive_web_view_link: driveWebViewLink ?? null,
  };
}

export function normalizeSession(row: any): SessionDTO {
  const id = toStringValue(row?.id) ?? (row?.id != null ? String(row.id) : '');
  const deal_id = toStringValue(row?.deal_id) ?? '';
  const deal_product_id = toStringValue(row?.deal_product_id) ?? '';
  const nombre_cache = toStringValue(row?.nombre_cache) ?? 'Sesión';
  const fecha_inicio_utc = toStringValue(row?.fecha_inicio_utc);
  const fecha_fin_utc = toStringValue(row?.fecha_fin_utc);
  const sala_id = toStringValue(row?.sala_id);
  const direccion = toStringValue(row?.direccion) ?? '';
  const estado = toSessionEstadoValue(row?.estado);
  const drive_url = toStringValue(row?.drive_url);
  const trainer_ids = toStringArray(row?.trainer_ids);
  const unidad_movil_ids = toStringArray(row?.unidad_movil_ids);

  return {
    id,
    deal_id,
    deal_product_id,
    nombre_cache,
    fecha_inicio_utc: fecha_inicio_utc ?? null,
    fecha_fin_utc: fecha_fin_utc ?? null,
    sala_id: sala_id ?? null,
    direccion,
    estado,
    drive_url: drive_url ?? null,
    trainer_ids,
    unidad_movil_ids,
  };
}

export function normalizeSessionGroup(raw: any): SessionGroupDTO {
  const productId = toStringValue(raw?.product?.id) ?? (raw?.product?.id != null ? String(raw.product.id) : '');
  const productCode = toStringValue(raw?.product?.code);
  const productName = toStringValue(raw?.product?.name);
  const quantity = toNumber(raw?.product?.quantity) ?? 0;

  const sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
  const pagination = raw?.pagination ?? {};

  return {
    product: {
      id: productId,
      code: productCode ?? null,
      name: productName ?? null,
      quantity,
    },
    sessions: sessions.map((session: any) => normalizeSession(session)),
    pagination: {
      page: toNonNegativeInteger(pagination?.page),
      limit: toNonNegativeInteger(pagination?.limit) || 20,
      total: toNonNegativeInteger(pagination?.total),
      totalPages: toNonNegativeInteger(pagination?.totalPages),
    },
  };
}

export function normalizeSessionComment(raw: any): SessionComment {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const content = toStringValue(raw?.content) ?? '';
  const author = toStringValue(raw?.author);
  const shareWithTrainer = Boolean(raw?.compartir_formador);
  const createdAt = toStringValue(raw?.created_at);
  const updatedAt = toStringValue(raw?.updated_at);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    content,
    author: author ?? null,
    compartir_formador: shareWithTrainer,
    created_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
  };
}

export function normalizeSessionDocument(raw: any): SessionDocument {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const fileType = toStringValue(raw?.file_type);
  const driveFileName = toStringValue(raw?.drive_file_name);
  const driveLink = toStringValue(raw?.drive_web_view_link);
  const createdAt = toStringValue(raw?.added_at ?? raw?.created_at);
  const updatedAt = toStringValue(raw?.updated_at);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    file_type: fileType ?? null,
    compartir_formador: Boolean(raw?.compartir_formador ?? raw?.share_with_trainer ?? false),
    added_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
    drive_file_name: driveFileName ?? null,
    drive_web_view_link: driveLink ?? null,
  };
}

export function normalizeSessionStudent(raw: any): SessionStudent {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const nombre = toStringValue(raw?.nombre) ?? '';
  const apellido = toStringValue(raw?.apellido) ?? '';
  const dni = toStringValue(raw?.dni) ?? '';
  const apto = Boolean(raw?.apto);
  const certificado = Boolean(raw?.certificado);
  const driveUrl = toStringValue(raw?.drive_url);
  const createdAt = toStringValue(raw?.created_at);
  const updatedAt = toStringValue(raw?.updated_at);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    nombre,
    apellido,
    dni,
    apto,
    certificado,
    drive_url: driveUrl ?? null,
    created_at: createdAt ?? null,
    updated_at: updatedAt ?? null,
  };
}

export function normalizeSessionPublicLink(raw: any): SessionPublicLink {
  const id = toStringValue(raw?.id) ?? (raw?.id != null ? String(raw.id) : '');
  const dealId = toStringValue(raw?.deal_id) ?? '';
  const sessionId = toStringValue(raw?.sesion_id) ?? '';
  const token = toStringValue(raw?.token) ?? '';
  const publicPath = toStringValue(raw?.public_path) ?? null;
  const publicUrl = toStringValue(raw?.public_url) ?? null;
  const createdAt = toStringValue(raw?.created_at) ?? null;
  const updatedAt = toStringValue(raw?.updated_at) ?? null;
  const expiresAt = toStringValue(raw?.expires_at) ?? null;
  const revokedAt = toStringValue(raw?.revoked_at) ?? null;
  const lastAccessAt = toStringValue(raw?.last_access_at) ?? null;
  const lastAccessIp = toStringValue(raw?.last_access_ip) ?? null;
  const lastAccessUa = toStringValue(raw?.last_access_ua) ?? null;
  const ipCreated = toStringValue(raw?.ip_created) ?? null;
  const userAgent = toStringValue(raw?.user_agent) ?? null;
  const active = Boolean(raw?.active);

  return {
    id,
    deal_id: dealId,
    sesion_id: sessionId,
    token,
    public_path: publicPath,
    public_url: publicUrl,
    created_at: createdAt,
    updated_at: updatedAt,
    expires_at: expiresAt,
    revoked_at: revokedAt,
    last_access_at: lastAccessAt,
    last_access_ip: lastAccessIp,
    last_access_ua: lastAccessUa,
    active,
    ip_created: ipCreated,
    user_agent: userAgent,
  };
}

export function normalizePublicSessionInfo(raw: any): PublicSessionInfo {
  return {
    deal_id: toStringValue(raw?.deal_id) ?? null,
    sesion_id: toStringValue(raw?.sesion_id) ?? null,
    session_name: toStringValue(raw?.session_name) ?? null,
    formation_name: toStringValue(raw?.formation_name) ?? null,
    title: toStringValue(raw?.title) ?? null,
  };
}

export function normalizeTrainerOption(raw: any): TrainerOption | null {
  const trainer_id = toStringValue(raw?.trainer_id) ?? (raw?.trainer_id != null ? String(raw.trainer_id) : '');
  if (!trainer_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  const apellido = toStringValue(raw?.apellido);
  const activoValue = raw?.activo;
  const activo = activoValue === undefined ? true : Boolean(activoValue);
  return { trainer_id, name, apellido: apellido ?? null, activo };
}

export function normalizeRoomOption(raw: any): RoomOption | null {
  const sala_id = toStringValue(raw?.sala_id) ?? (raw?.sala_id != null ? String(raw.sala_id) : '');
  if (!sala_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return { sala_id, name, sede: toStringValue(raw?.sede) ?? null };
}

export function normalizeMobileUnitOption(raw: any): MobileUnitOption | null {
  const unidad_id = toStringValue(raw?.unidad_id) ?? (raw?.unidad_id != null ? String(raw.unidad_id) : '');
  if (!unidad_id) return null;
  const name = toStringValue(raw?.name) ?? null;
  if (!name) return null;
  return { unidad_id, name, matricula: toStringValue(raw?.matricula) ?? null };
}

export function sanitizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = values
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length);
  return Array.from(new Set(normalized));
}

export function normalizeDriveUrlInput(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

export function sortStudentsByName(students: SessionStudent[]): SessionStudent[] {
  return students.slice().sort((a, b) => {
    const nameA = `${(a.apellido ?? '').trim()} ${(a.nombre ?? '').trim()}`.trim().toLowerCase();
    const nameB = `${(b.apellido ?? '').trim()} ${(b.nombre ?? '').trim()}`.trim().toLowerCase();
    if (nameA && nameB) {
      const compare = nameA.localeCompare(nameB, 'es');
      if (compare !== 0) {
        return compare;
      }
    }
    if (nameA) return -1;
    if (nameB) return 1;
    const dniA = (a.dni ?? '').trim().toUpperCase();
    const dniB = (b.dni ?? '').trim().toUpperCase();
    if (dniA && dniB) {
      const compare = dniA.localeCompare(dniB, 'es');
      if (compare !== 0) {
        return compare;
      }
    }
    if (dniA) return -1;
    if (dniB) return 1;
    return (a.id ?? '').localeCompare(b.id ?? '', 'es');
  });
}
