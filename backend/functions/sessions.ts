// backend/functions/sesiones.ts
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { logAudit, resolveUserIdFromEvent, type JsonValue } from './_shared/audit-log';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { isTrustedClient, logSuspiciousRequest } from './_shared/security';
import {
  getVariantResourceColumnsSupport,
  isVariantResourceColumnError,
  setVariantResourceColumnsSupport,
} from './_shared/variant-resources';
import {
  generateSessionsForDeal,
  hasApplicableCode,
  reindexSessionNames,
  toNonNegativeInt,
} from './_shared/sessionGeneration';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
type SessionEstado = 'BORRADOR' | 'PLANIFICADA' | 'SUSPENDIDA' | 'CANCELADA' | 'FINALIZADA';

const SESSION_STATE_VALUES: SessionEstado[] = [
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
];
const MANUAL_SESSION_STATES = new Set<SessionEstado>(['SUSPENDIDA', 'CANCELADA', 'FINALIZADA']);
const BORRADOR_TRANSITION_STATES = new Set<SessionEstado>(['SUSPENDIDA', 'CANCELADA']);

type AutomaticSessionEstado = Extract<SessionEstado, 'BORRADOR' | 'PLANIFICADA'>;

// Unidades “comodín” que no bloquean disponibilidad
const ALWAYS_AVAILABLE_UNIT_IDS = new Set([
  '52377f13-05dd-4830-88aa-0f5c78bee750',
  '0000',
]);

const MADRID_DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatMadridDate(date: Date): string {
  return MADRID_DATE_ONLY_FORMATTER.format(date);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}
function toOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}
function shouldForceEstadoBorrador(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return false;
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    return value === 1;
  }
  return false;
}
function parseJson(body: string | null | undefined): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
function toPositiveInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

const TIEMPO_PARADA_VALUES = new Set([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    const record = value as { toNumber?: () => number; toString?: () => string };
    if (typeof record.toNumber === 'function') {
      const parsed = record.toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof record.toString === 'function') {
      const parsed = Number(record.toString());
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function parseTiempoParada(value: unknown): { value?: number | null; error?: ReturnType<typeof errorResponse> } {
  if (value === undefined) return {};
  if (value === null || value === '') return { value: null };
  const parsed = toNumberOrNull(value);
  if (parsed === null) {
    return { error: errorResponse('VALIDATION_ERROR', 'Tiempo de parada inválido', 400) };
  }
  if (!TIEMPO_PARADA_VALUES.has(parsed)) {
    return { error: errorResponse('VALIDATION_ERROR', 'Tiempo de parada fuera de rango', 400) };
  }
  return { value: parsed };
}
function parseSessionIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toIsoOrNull(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  try {
    const d = date instanceof Date ? date : new Date(date);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

type SessionTrainerLink = {
  trainer_id: string;
  trainers?: { trainer_id: string; name?: string | null; apellido?: string | null } | null;
};

type SessionUnitLink = {
  unidad_id: string | null;
  unidad_movil_id?: string | null;
  unidades_moviles?: { unidad_id?: string | null; name?: string | null; matricula?: string | null } | null;
};

type SessionStudentRecord = {
  id?: string | null;
  nombre?: string | null;
  apellido?: string | null;
  dni?: string | null;
};

type TrainerInviteStatusValue = 'PENDING' | 'CONFIRMED' | 'DECLINED';

type SessionTrainerInviteSummaryStatus = 'NOT_SENT' | TrainerInviteStatusValue;

type SessionTrainerInviteLink = {
  trainer_id: string | null;
  status: TrainerInviteStatusValue;
  sent_at: Date | string | null;
  responded_at: Date | string | null;
};

type SessionRecord = {
  id: string;
  deal_id: string;
  deal_product_id: string;
  nombre_cache: string;
  fecha_inicio_utc: Date | null;
  fecha_fin_utc: Date | null;
  tiempo_parada: unknown;
  sala_id: string | null;
  direccion: string;
  estado: SessionEstado;
  drive_url: string | null;
  trainers: SessionTrainerLink[];
  sesion_trainers?: SessionTrainerLink[];
  unidades: SessionUnitLink[];
  sesion_unidades?: SessionUnitLink[];
  deal?: { sede_label: string | null; pipeline_id: string | null } | null;
  deal_product?: { id?: string | null; name?: string | null; code?: string | null } | null;
  salas?: { sala_id?: string | null; name?: string | null; sede?: string | null } | null;
  _count?: { alumnos?: number | null } | null;
  alumnos?: SessionStudentRecord[] | null;
  trainer_invites?: SessionTrainerInviteLink[] | null;
  trainer_session_invites?: SessionTrainerInviteLink[] | null;
};

type SessionStudentResponse = {
  id: string | null;
  nombre: string | null;
  apellido: string | null;
  dni: string | null;
};

function normalizeSessionUnitLink(link: any): SessionUnitLink {
  if (!link || typeof link !== 'object') {
    return { unidad_id: null };
  }

  const record = link as SessionUnitLink & { unidad_movil_id?: string | null };
  const directId = toTrimmed(record.unidad_id);
  const movilId = toTrimmed(record.unidad_movil_id);
  const relationId = record.unidades_moviles && typeof record.unidades_moviles === 'object'
    ? toTrimmed((record.unidades_moviles as { unidad_id?: string | null }).unidad_id)
    : null;

  const resolvedId = directId ?? movilId ?? relationId ?? null;
  record.unidad_id = resolvedId;
  record.unidad_movil_id = resolvedId;

  if (record.unidades_moviles && typeof record.unidades_moviles === 'object' && resolvedId && record.unidades_moviles.unidad_id == null) {
    record.unidades_moviles.unidad_id = resolvedId;
  }

  return record;
}

function mapSessionStudentForResponse(
  student: SessionStudentRecord | null | undefined,
): SessionStudentResponse | null {
  if (!student || typeof student !== 'object') {
    return null;
  }

  const id = toTrimmed(student.id);
  const nombre = toTrimmed(student.nombre);
  const apellido = toTrimmed(student.apellido);
  const dni = toTrimmed(student.dni);

  if (!id && !nombre && !apellido && !dni) {
    return null;
  }

  return {
    id,
    nombre,
    apellido,
    dni,
  };
}

function normalizeTrainerInviteStatusValue(value: unknown): TrainerInviteStatusValue {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (text === 'CONFIRMED' || text === 'DECLINED') {
    return text;
  }
  return 'PENDING';
}

function normalizeSessionTrainerInviteLink(link: any): SessionTrainerInviteLink {
  if (!link || typeof link !== 'object') {
    return { trainer_id: null, status: 'PENDING', sent_at: null, responded_at: null };
  }

  const record = link as {
    trainer_id?: unknown;
    status?: unknown;
    sent_at?: Date | string | null;
    responded_at?: Date | string | null;
  };
  return {
    trainer_id: record?.trainer_id ? String(record.trainer_id) : null,
    status: normalizeTrainerInviteStatusValue(record.status),
    sent_at: record.sent_at ?? null,
    responded_at: record.responded_at ?? null,
  };
}

function resolveTrainerInviteSummaryStatus(
  invites: SessionTrainerInviteLink[] | null | undefined,
  trainerIds?: string[] | null,
): SessionTrainerInviteSummaryStatus {
  if (!Array.isArray(invites) || invites.length === 0) {
    return 'NOT_SENT';
  }
  const normalizedIds = Array.isArray(trainerIds)
    ? new Set(trainerIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter((id) => id.length))
    : null;
  const relevantInvites = normalizedIds
    ? invites.filter((invite) => {
        const trainerId = typeof invite.trainer_id === 'string' ? invite.trainer_id.trim() : '';
        return trainerId.length ? normalizedIds.has(trainerId) : false;
      })
    : invites;

  if (relevantInvites.length === 0) {
    return 'NOT_SENT';
  }
  if (relevantInvites.some((invite) => invite.status === 'DECLINED')) {
    return 'DECLINED';
  }
  if (relevantInvites.some((invite) => invite.status === 'CONFIRMED')) {
    return 'CONFIRMED';
  }
  return 'PENDING';
}

function ensureSessionRelations(row: any): SessionRecord {
  if (!row || typeof row !== 'object') return row as SessionRecord;
  const record = row as SessionRecord & {
    sesion_trainers?: SessionTrainerLink[];
    sesion_unidades?: SessionUnitLink[];
    trainer_session_invites?: SessionTrainerInviteLink[];
    trainer_invites?: SessionTrainerInviteLink[];
  };
  if (record.deal == null && (record as any).deals !== undefined) {
    record.deal = (record as any).deals ?? null;
  }
  if ((record as any).deal_product == null && (record as any).deal_products !== undefined) {
    (record as any).deal_product = (record as any).deal_products;
  }
  if ((record as any).salas == null && (record as any).salas !== undefined) {
    (record as any).salas = (record as any).salas;
  }
  record.trainers = Array.isArray(record.trainers)
    ? record.trainers
    : Array.isArray(record.sesion_trainers)
      ? record.sesion_trainers
      : [];
  record.unidades = Array.isArray(record.unidades)
    ? record.unidades.map((link) => normalizeSessionUnitLink(link))
    : Array.isArray(record.sesion_unidades)
      ? record.sesion_unidades.map((link) => normalizeSessionUnitLink(link))
      : [];
  const invitesSource = Array.isArray(record.trainer_invites)
    ? record.trainer_invites
    : Array.isArray(record.trainer_session_invites)
      ? record.trainer_session_invites
      : [];
  record.trainer_invites = invitesSource.map((invite) => normalizeSessionTrainerInviteLink(invite));
  return record;
}

function ensureSessionRelationsOrNull(row: any): SessionRecord | null {
  return row ? ensureSessionRelations(row) : null;
}

function ensureSessionRelationsList(rows: any[]): SessionRecord[] {
  return rows.map((row) => ensureSessionRelations(row));
}

const SEDE_ALIASES: Record<string, string> = {
  'c/ moratín, 100, 08206 sabadell, barcelona': 'GEP Sabadell',
  'c/ primavera, 1, 28500, arganda del rey, madrid': 'GEP Arganda',
  'in company': 'In Company',
  'in company - unidad movil': 'In Company',
  'in company - unidad móvil': 'In Company',
  'in company - unidades_moviles móvil': 'In Company',
};
function normalizeSedeLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed.length) return null;
  const alias = SEDE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

const PIPELINES_ALLOW_PLANIFICADA_WITHOUT_DATES = new Set([
  'gep services',
  'preventivos',
  'pci',
  'formacion empresas',
  'formacion empresa',
]);
const PIPELINES_ALLOW_PLANIFICADA_WITHOUT_ROOM = new Set(['gep services', 'preventivos', 'pci']);

function normalizePipelineLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed.length) return null;
  return trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function allowsAutomaticPlanificadaWithoutDates(pipelineLabel: string | null | undefined): boolean {
  const normalized = normalizePipelineLabel(pipelineLabel);
  if (!normalized) return false;
  return PIPELINES_ALLOW_PLANIFICADA_WITHOUT_DATES.has(normalized);
}
function allowsAutomaticPlanificadaWithoutRoom(pipelineLabel: string | null | undefined): boolean {
  const normalized = normalizePipelineLabel(pipelineLabel);
  if (!normalized) return false;
  return PIPELINES_ALLOW_PLANIFICADA_WITHOUT_ROOM.has(normalized);
}
function toSessionEstado(value: unknown): SessionEstado | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized.length) return null;
  return SESSION_STATE_VALUES.includes(normalized as SessionEstado)
    ? (normalized as SessionEstado)
    : null;
}
function isManualSessionEstado(value: SessionEstado | null | undefined): boolean {
  return value ? MANUAL_SESSION_STATES.has(value) : false;
}
function isBorradorTransitionEstado(value: SessionEstado | null | undefined): boolean {
  return value ? BORRADOR_TRANSITION_STATES.has(value) : false;
}

function computeAutomaticSessionEstadoFromValues(args: {
  fechaInicio: Date | null | undefined;
  fechaFin: Date | null | undefined;
  salaId: string | null | undefined;
  trainerIds: string[];
  unidadIds: string[];
  dealSede?: string | null;
  dealPipeline?: string | null;
}): AutomaticSessionEstado {
  const { fechaInicio, fechaFin, salaId, trainerIds, unidadIds, dealSede, dealPipeline } = args;
  const allowWithoutDates = allowsAutomaticPlanificadaWithoutDates(dealPipeline);
  const allowWithoutRoom = allowsAutomaticPlanificadaWithoutRoom(dealPipeline);
  const hasValidDates = Boolean(fechaInicio && fechaFin);
  const normalizedSede = normalizeSedeLabel(dealSede);
  const requiresRoom = !allowWithoutRoom && normalizedSede !== 'In Company';
  if (requiresRoom && (!salaId || !String(salaId).trim().length)) return 'BORRADOR';
  if (!trainerIds || !trainerIds.length) return 'BORRADOR';
  if (!unidadIds || !unidadIds.length) return 'BORRADOR';
  if (hasValidDates || allowWithoutDates) return 'PLANIFICADA';
  return 'BORRADOR';
}
function resolveAutomaticSessionEstado(row: SessionRecord): AutomaticSessionEstado {
  const normalized = ensureSessionRelations(row);
  const storedEstado = toSessionEstado(normalized.estado);
  if (storedEstado === 'BORRADOR') {
    const hasStart = normalized.fecha_inicio_utc instanceof Date;
    const hasEnd = normalized.fecha_fin_utc instanceof Date;
    if (!hasStart && !hasEnd) {
      return 'BORRADOR';
    }
  }
  const trainerIds = normalized.trainers
    .map((t) => t.trainer_id)
    .filter((id): id is string => Boolean(id));
  const unidadIds = normalized.unidades
    .map((u) => u.unidad_id ?? null)
    .filter((id): id is string => Boolean(id));
  return computeAutomaticSessionEstadoFromValues({
    fechaInicio: normalized.fecha_inicio_utc,
    fechaFin: normalized.fecha_fin_utc,
    salaId: normalized.sala_id,
    trainerIds,
    unidadIds,
    dealSede: normalized.deal?.sede_label ?? null,
    dealPipeline: normalized.deal?.pipeline_id ?? null,
  });
}
function resolveSessionEstado(row: SessionRecord): SessionEstado {
  if (isManualSessionEstado(row.estado)) return row.estado;
  return resolveAutomaticSessionEstado(row);
}
async function applyAutomaticSessionState(
  tx: Prisma.TransactionClient,
  sesiones: SessionRecord[],
): Promise<void> {
  const updates: Promise<unknown>[] = [];
  sesiones.forEach((session: SessionRecord) => {
    const normalized = ensureSessionRelations(session);
    if (isManualSessionEstado(normalized.estado)) return;
    const autoEstado = resolveAutomaticSessionEstado(normalized);
    if (normalized.estado !== autoEstado) {
      normalized.estado = autoEstado;
      updates.push(
        tx.sesiones.update({
          where: { id: normalized.id },
          data: { estado: autoEstado } as Record<string, any>,
        }),
      );
    } else {
      normalized.estado = autoEstado;
    }
  });
  if (updates.length) await Promise.all(updates);
}

function normalizeSession(row: SessionRecord) {
  const normalized = ensureSessionRelations(row);
  const trainerIds = normalized.trainers.map((t) => t.trainer_id);
  const unidadIds = normalized.unidades.map((u) => u.unidad_id);
  const estado = resolveSessionEstado(normalized);
  const trainerInviteStatus = resolveTrainerInviteSummaryStatus(normalized.trainer_invites, trainerIds);
  const trainerInvites = Array.isArray(normalized.trainer_invites)
    ? normalized.trainer_invites.map((invite) => ({
        trainer_id: invite.trainer_id ? String(invite.trainer_id) : null,
        status: invite.status,
        sent_at: toIsoOrNull(invite.sent_at),
        responded_at: toIsoOrNull(invite.responded_at),
      }))
    : [];
  return {
    id: normalized.id,
    deal_id: normalized.deal_id,
    deal_product_id: normalized.deal_product_id,
    nombre_cache: normalized.nombre_cache,
    fecha_inicio_utc: toIsoOrNull(normalized.fecha_inicio_utc),
    fecha_fin_utc: toIsoOrNull(normalized.fecha_fin_utc),
    tiempo_parada: toNumberOrNull(normalized.tiempo_parada),
    sala_id: normalized.sala_id,
    direccion: normalized.direccion,
    estado,
    drive_url: toTrimmed(normalized.drive_url),
    trainer_ids: trainerIds,
    unidad_movil_ids: unidadIds,
    trainer_invite_status: trainerInviteStatus,
    trainer_invites: trainerInvites,
  };
}

function buildSessionAuditSnapshot(session: ReturnType<typeof normalizeSession>) {
  return {
    id: session.id,
    deal_id: session.deal_id,
    deal_product_id: session.deal_product_id,
    estado: session.estado,
    fecha_inicio_utc: session.fecha_inicio_utc,
    fecha_fin_utc: session.fecha_fin_utc,
    tiempo_parada: session.tiempo_parada,
    sala_id: session.sala_id,
    direccion: session.direccion,
    trainer_ids: session.trainer_ids,
    unidad_movil_ids: session.unidad_movil_ids,
  };
}
function buildNombreBase(name?: string | null, code?: string | null): string {
  const fallback = 'Sesión';
  const raw = toTrimmed(name) ?? toTrimmed(code);
  return raw ?? fallback;
}

function parseDateInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const text = String(value).trim();
  if (!text.length) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return { error: errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400) };
  return parsed;
}

function parseDateInputFlexible(v: any): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;

  const s = String(v).trim();
  if (!s) return null;

  // Acepta YYYY-MM-DD → forzamos medianoche UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00.000Z');
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function getCalendarFlag(q: Record<string, any> | null | undefined): boolean {
  const raw = (q?.calendar ?? q?.scope ?? q?.view ?? '').toString().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'calendar';
}

function getCalendarRangeFromQuery(q: Record<string, any> | null | undefined): { from: Date; to: Date } | null {
  if (!q) return null;
  const rawFrom = q.from_utc ?? q.from ?? q.start;
  const rawTo   = q.to_utc   ?? q.to   ?? q.end;

  const from = parseDateInputFlexible(rawFrom);
  const to   = parseDateInputFlexible(rawTo);

  if (!from || !to) return null;
  if (to.getTime() < from.getTime()) return null;

  // Límite opcional de 120 días
  const MAX_MS = 120 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > MAX_MS) return null;

  return { from, to };
}

function ensureArrayOfStrings(
  value: unknown,
): string[] | { error: ReturnType<typeof errorResponse> } {
  if (value === undefined) return [];
  if (value === null) return [];
  if (!Array.isArray(value)) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo debe ser un array de strings', 400) };
  }
  const items: string[] = [];
  for (const entry of value) {
    const trimmed = toTrimmed(entry);
    if (!trimmed) continue;
    if (!items.includes(trimmed)) items.push(trimmed);
  }
  return items;
}

type SessionPatchResult =
  | {
      data: Record<string, any>;
      trainerIds?: string[];
      unidadIds?: string[];
      estado?: SessionEstado;
    }
  | { error: ReturnType<typeof errorResponse> };

function buildSessionPatch(body: any): SessionPatchResult {
  if (!body || typeof body !== 'object') {
    return { error: errorResponse('VALIDATION_ERROR', 'Body inválido', 400) };
  }
  const data: Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'fecha_inicio_utc')) {
    const parsed = parseDateInput(body.fecha_inicio_utc);
    if (parsed && 'error' in parsed) return { error: parsed.error };
    data.fecha_inicio_utc = parsed === undefined ? undefined : (parsed as Date | null);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'fecha_fin_utc')) {
    const parsed = parseDateInput(body.fecha_fin_utc);
    if (parsed && 'error' in parsed) return { error: parsed.error };
    data.fecha_fin_utc = parsed === undefined ? undefined : (parsed as Date | null);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sala_id')) {
    const value = body.sala_id === null ? null : toTrimmed(body.sala_id);
    data.sala_id = value ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'direccion')) {
    const value = toOptionalText(body.direccion);
    if (value == null) return { error: errorResponse('VALIDATION_ERROR', 'La dirección es obligatoria', 400) };
    data.direccion = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tiempo_parada')) {
    const parsed = parseTiempoParada(body.tiempo_parada);
    if (parsed.error) return { error: parsed.error };
    if ('value' in parsed) {
      data.tiempo_parada = parsed.value ?? null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'nombre_cache')) {
    const value = toOptionalText(body.nombre_cache);
    data.nombre_cache = value ?? 'Sesión';
  }

  let trainerIds: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'trainer_ids')) {
    const res = ensureArrayOfStrings(body.trainer_ids);
    if (res && 'error' in res) return { error: res.error };
    trainerIds = res;
  }
  let unidadIds: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'unidad_movil_ids')) {
    const res = ensureArrayOfStrings(body.unidad_movil_ids);
    if (res && 'error' in res) return { error: res.error };
    unidadIds = res;
  }

  let estado: SessionEstado | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'estado')) {
    const parsedEstado = toSessionEstado(body.estado);
    if (!parsedEstado) return { error: errorResponse('VALIDATION_ERROR', 'Estado inválido', 400) };
    estado = parsedEstado;
  }

  return { data, trainerIds, unidadIds, estado };
}

function ensureValidDateRange(start?: Date | null, end?: Date | null) {
  if (start && end && end.getTime() < start.getTime()) {
    return errorResponse('VALIDATION_ERROR', 'La fecha de fin no puede ser anterior al inicio', 400);
  }
  return null;
}

type DateRange = { start: Date; end: Date };
function normalizeDateRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
): DateRange | null {
  const effectiveStart = start ?? end ?? null;
  const effectiveEnd = end ?? start ?? null;
  if (!effectiveStart || !effectiveEnd) return null;
  const startTime = effectiveStart.getTime();
  const endTime = effectiveEnd.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  if (endTime < startTime) return null;
  return { start: new Date(startTime), end: new Date(endTime) };
}

type VariantTimeParts = { hour: number; minute: number };

type MadridDayInfo = { iso: string; year: number; month: number; day: number; weekday: number };

function getMadridDayInfo(date: Date): MadridDayInfo {
  const iso = formatMadridDate(date);
  const [yearText, monthText, dayText] = iso.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { iso, year, month, day, weekday };
}

function enumerateMadridDays(range: DateRange): MadridDayInfo[] {
  const startInfo = getMadridDayInfo(range.start);
  const endInfo = getMadridDayInfo(range.end);
  const days: MadridDayInfo[] = [];

  let current = startInfo;
  // Itera de forma inclusiva desde startInfo hasta endInfo
  while (true) {
    const weekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
    days.push({
      iso: `${current.year}-${pad2(current.month)}-${pad2(current.day)}`,
      year: current.year,
      month: current.month,
      day: current.day,
      weekday,
    });

    if (
      current.year === endInfo.year &&
      current.month === endInfo.month &&
      current.day === endInfo.day
    ) {
      break;
    }

    const nextDate = new Date(Date.UTC(current.year, current.month - 1, current.day) + 24 * 60 * 60 * 1000);
    current = getMadridDayInfo(nextDate);
  }

  return days;
}

async function fetchScheduleAvailableTrainerIds(
  prisma: Prisma.TransactionClient,
  range: DateRange,
): Promise<Set<string>> {
  const trainerRows = await prisma.trainers.findMany({
    where: { activo: true },
    select: { trainer_id: true },
  });

  const trainerIds = trainerRows
    .map((row: { trainer_id: string | null }) => row.trainer_id)
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0);

  if (!trainerIds.length) {
    return new Set<string>();
  }

  const days = enumerateMadridDays(range);
  if (!days.length) {
    return new Set<string>(trainerIds);
  }

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const overrides = await prisma.trainer_availability.findMany({
    where: {
      trainer_id: { in: trainerIds },
      date: {
        gte: new Date(Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day, 0, 0, 0, 0)),
        lte: new Date(Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day, 0, 0, 0, 0)),
      },
    },
    select: { trainer_id: true, date: true, available: true },
  });

  const overrideMap = new Map<string, Map<string, boolean>>();
  for (const entry of overrides) {
    const iso = formatMadridDate(entry.date);
    let map = overrideMap.get(iso);
    if (!map) {
      map = new Map<string, boolean>();
      overrideMap.set(iso, map);
    }
    map.set(entry.trainer_id, Boolean(entry.available));
  }

  const available = new Set<string>(trainerIds);

  for (const day of days) {
    const defaultAvailable = true;
    const overridesForDay = overrideMap.get(day.iso);

    for (const trainerId of trainerIds) {
      if (!available.has(trainerId)) continue;
      const override = overridesForDay?.get(trainerId);
      const isAvailable = override !== undefined ? override : defaultAvailable;
      if (!isAvailable) {
        available.delete(trainerId);
      }
    }

    if (!available.size) {
      break;
    }
  }

  return available;
}
function extractVariantTimeParts(value: Date | string | null | undefined): VariantTimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const m = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
function buildVariantDateTime(date: Date, time: VariantTimeParts | null, fallback: VariantTimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}
function computeVariantRange(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): DateRange | null {
  if (!variantDate) return null;
  const parsedDate = new Date(variantDate as any);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const startTime = extractVariantTimeParts(productTimes.hora_inicio);
  const endTime = extractVariantTimeParts(productTimes.hora_fin);
  const fallbackStart: VariantTimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: VariantTimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildVariantDateTime(parsedDate, startTime, fallbackStart);
  let end = buildVariantDateTime(parsedDate, endTime, fallbackEnd);
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

async function ensureResourcesAvailable(
  tx: Prisma.TransactionClient,
  args: {
    sessionId?: string;
    trainerIds?: string[];
    unidadIds?: string[];
    salaId?: string | null;
    start?: Date | null;
    end?: Date | null;
  },
) {
  const { sessionId, trainerIds, unidadIds, salaId, start, end } = args;
  const range = normalizeDateRange(start ?? null, end ?? null);
  if (!range) return;

  const resourceConditions: any[] = [];

  if (trainerIds && trainerIds.length) {
    resourceConditions.push({ sesion_trainers: { some: { trainer_id: { in: trainerIds } } } });
  }
  const filteredUnidadIds = (unidadIds ?? []).filter((id) => (id ? !ALWAYS_AVAILABLE_UNIT_IDS.has(id) : false));
  if (filteredUnidadIds.length) {
    resourceConditions.push({ sesion_unidades: { some: { unidad_movil_id: { in: filteredUnidadIds } } } });
  }
  if (salaId) {
    resourceConditions.push({ sala_id: salaId });
  }
  if (!resourceConditions.length) return;

  const sessionsRaw = await tx.sesiones.findMany({
    where: { ...(sessionId ? { id: { not: sessionId } } : {}), OR: resourceConditions },
    select: {
      id: true,
      fecha_inicio_utc: true,
      fecha_fin_utc: true,
      sala_id: true,
      sesion_trainers: { select: { trainer_id: true } },
      sesion_unidades: { select: { unidad_movil_id: true } },
    },
  });

  const sesiones = ensureSessionRelationsList(sessionsRaw as any[]);

  const conflicting = sesiones.filter((s: any) => {
    const r = normalizeDateRange(s.fecha_inicio_utc, s.fecha_fin_utc);
    if (!r) return false;
    return r.start.getTime() <= range.end.getTime() && r.end.getTime() >= range.start.getTime();
  });
  if (!conflicting.length) return;

  throw errorResponse('RESOURCE_UNAVAILABLE', 'Algunos recursos ya están asignados en las fechas seleccionadas.', 409);
}

function parseLimit(value: unknown): number {
  const parsed = toPositiveInt(value, DEFAULT_LIMIT);
  return Math.min(parsed || DEFAULT_LIMIT, MAX_LIMIT);
}

async function fetchSessionsByProduct(
  prisma: Prisma.TransactionClient,
  dealId: string,
  productId: string,
  page: number,
  limit: number,
) {
  const [total, rawRows] = await Promise.all([
    prisma.sesiones.count({ where: { deal_id: dealId, deal_product_id: productId } }),
    prisma.sesiones.findMany({
      where: { deal_id: dealId, deal_product_id: productId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        sesion_trainers: { select: { trainer_id: true } },
        sesion_unidades: { select: { unidad_movil_id: true } },
        deals: { select: { sede_label: true, pipeline_id: true } },
        trainer_session_invites: { select: { trainer_id: true, status: true, sent_at: true, responded_at: true } },
      },
    }),
  ]);

  const rows = ensureSessionRelationsList(rawRows as any[]);

  await applyAutomaticSessionState(prisma, rows as unknown as SessionRecord[]);
  return { total, rows };
}

export const __test__ = {
  ensureSessionRelations,
  resolveSessionEstado,
  resolveAutomaticSessionEstado,
  normalizeSedeLabel,
};

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') return preflightResponse();

    const prisma = getPrisma();
    const method = event.httpMethod;

    if (!isTrustedClient(event.headers)) {
      await logSuspiciousRequest({
        event,
        headers: event.headers,
        method: method ?? 'UNKNOWN',
        path: String(event.path || ''),
        rawUrl: event.rawUrl ?? null,
        reason: 'missing_or_invalid_client_header',
      });
    }

    // Usa path o rawUrl (en Netlify local a veces solo viene rawUrl)
    const pathOrUrl = String(event.path || event.rawUrl || '');
    const query = event.queryStringParameters ?? {};
    const isCalendarMode = getCalendarFlag(query);

    // Acepta /sesiones y /sessions y tolera querystring
    const isAvailabilityRequest =
      /\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/availability(?:\?|$)/i.test(pathOrUrl);
    const isRangeRequest =
      /\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/range(?:\?|$)/i.test(pathOrUrl);
    const isDealSessionsRequest =
      /\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/by-deal(?:\?|$)/i.test(pathOrUrl);
    const isUnplannedSessionsRequest =
      /\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/unplanned(?:\?|$)/i.test(pathOrUrl);
    const isCountsRequest =
      /\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/[^/]+\/counts(?:\?|$)/i.test(pathOrUrl);

    // Para PATCH/DELETE lee el id desde pathOrUrl
    const sessionIdFromPath =
      isAvailabilityRequest || isDealSessionsRequest ? null : parseSessionIdFromPath(pathOrUrl);

    // Generate from deal
    if (
  method === 'POST' &&
  /\/(?:\.netlify\/functions\/)?(?:sesiones|sessions)\/generate-from-deal(?:\?|$)/i.test(pathOrUrl)
) {
      const body = parseJson(event.body);
      const dealId = toTrimmed(body?.dealId);
      if (!dealId) return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);
      const result = await prisma.$transaction((tx: Prisma.TransactionClient) => generateSessionsForDeal(tx, dealId));
      if ('error' in result) return result.error;
      return successResponse({ count: result.count ?? 0 });
    }

    const normalizePipelineKey = (value: unknown): string =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const allowedPipelines = new Set<string>([
      normalizePipelineKey('Formación Empresa'),
      normalizePipelineKey('Formación Empresas'),
      normalizePipelineKey('GEP Services'),
    ]);

    const isAllowedPipeline = (label: unknown, id: unknown): boolean => {
      const normalizedLabel = normalizePipelineKey(label);
      if (normalizedLabel && allowedPipelines.has(normalizedLabel)) return true;
      const normalizedId = normalizePipelineKey(id);
      if (normalizedId && allowedPipelines.has(normalizedId)) return true;
      return false;
    };

    // Availability
    if (method === 'GET' && isAvailabilityRequest) {
      const startParam = toTrimmed(event.queryStringParameters?.start);
      if (!startParam) return errorResponse('VALIDATION_ERROR', 'El parámetro start es obligatorio', 400);
      const startResult = parseDateInput(startParam);
      if (startResult && 'error' in startResult) return startResult.error;
      const startDate = startResult as Date | null | undefined;
      if (!startDate) return errorResponse('VALIDATION_ERROR', 'El parámetro start es inválido', 400);

      const endParam = toTrimmed(event.queryStringParameters?.end);
      const endResult = endParam === null ? null : parseDateInput(endParam ?? undefined);
      if (endResult && typeof endResult === 'object' && 'error' in endResult) return endResult.error;
      const endDate = endResult === undefined ? null : ((endResult as Date | null | undefined) ?? null);

      const range = normalizeDateRange(startDate, endDate ?? startDate);
      if (!range) return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);

      const excludeSessionId = toTrimmed(event.queryStringParameters?.excludeSessionId);
      const excludeVariantId = toTrimmed(event.queryStringParameters?.excludeVariantId);

      const scheduleAvailableTrainerSet = await fetchScheduleAvailableTrainerIds(prisma, range);

      const sessionsRaw = await prisma.sesiones.findMany({
        where: {
          ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
          OR: [{ sala_id: { not: null } }, { sesion_trainers: { some: {} } }, { sesion_unidades: { some: {} } }],
        },
        select: {
          id: true,
          sala_id: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          sesion_trainers: { select: { trainer_id: true } },
        sesion_unidades: { select: { unidad_movil_id: true } },
        },
      });

      const sesiones = ensureSessionRelationsList(sessionsRaw as any[]);

      const trainerLocks = new Set<string>();
      const roomLocks = new Set<string>();
      const unitLocks = new Set<string>();

      sesiones.forEach((s: SessionRecord) => {
        const r = normalizeDateRange(s.fecha_inicio_utc, s.fecha_fin_utc);
        if (!r) return;
        if (r.start.getTime() <= range.end.getTime() && r.end.getTime() >= range.start.getTime()) {
          (s.trainers as Array<{ trainer_id: string }>).forEach((t) => trainerLocks.add(t.trainer_id));
          (s.unidades as Array<{ unidad_id: string | null; unidad_movil_id?: string | null }>).forEach((u) => {
            const id = toTrimmed(u.unidad_id ?? u.unidad_movil_id);
            if (id && !ALWAYS_AVAILABLE_UNIT_IDS.has(id)) unitLocks.add(id);
          });
          if (s.sala_id) roomLocks.add(s.sala_id as string);
        }
      });

      if (getVariantResourceColumnsSupport() !== false) {
        try {
          const variants = await prisma.variants.findMany({
            where: {
              ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
              date: { not: null },
              OR: [{ trainer_id: { not: null } }, { sala_id: { not: null } }, { unidad_movil_id: { not: null } }],
            },
            select: {
              id: true,
              date: true,
              trainer_id: true,
              sala_id: true,
              unidad_movil_id: true,
              products: { select: { hora_inicio: true, hora_fin: true } },
            },
          } as any);
          setVariantResourceColumnsSupport(true);

          (variants as any[]).forEach((v: any) => {
            const vr = computeVariantRange(v.date, v.products ?? { hora_inicio: null, hora_fin: null });
            if (!vr) return;
            if (vr.start.getTime() <= range.end.getTime() && vr.end.getTime() >= range.start.getTime()) {
              if (v.trainer_id) trainerLocks.add(v.trainer_id as string);
              if (v.sala_id) roomLocks.add(v.sala_id as string);
              if (v.unidad_movil_id && !ALWAYS_AVAILABLE_UNIT_IDS.has(v.unidad_movil_id as string)) {
                unitLocks.add(v.unidad_movil_id as string);
              }
            }
          });
        } catch (error) {
          if (isVariantResourceColumnError(error)) {
            setVariantResourceColumnsSupport(false);
            console.warn('[sesiones] skipping variant resource check (missing resource columns)', { error });
          } else {
            throw error;
          }
        }
      }

      return successResponse({
        availability: {
          trainers: Array.from(trainerLocks),
          rooms: Array.from(roomLocks),
          units: Array.from(unitLocks),
          availableTrainers: Array.from(scheduleAvailableTrainerSet),
        },
      });
    }

    // Unplanned sessions (no start/end date) for Formación Empresa & GEP Services
    if (method === 'GET' && isUnplannedSessionsRequest) {
      const rawSessions = await prisma.sesiones.findMany({
        where: {
          fecha_inicio_utc: null,
          fecha_fin_utc: null,
          sesion_trainers: { none: {} },
          deals: {
            w_id_variation: null,
          },
        },
        select: {
          id: true,
          deal_id: true,
          nombre_cache: true,
          deals: {
            select: {
              pipeline_label: true,
              pipeline_id: true,
              organizations: { select: { name: true } },
            },
          },
          deal_products: { select: { name: true, code: true, type: true } },
        },
        orderBy: [{ deal_id: 'asc' }, { nombre_cache: 'asc' }],
      });

      const sesiones = (rawSessions as any[])
        .filter((session) =>
          isAllowedPipeline(
            session?.deals?.pipeline_label ?? null,
            session?.deals?.pipeline_id ?? null,
          ),
        )
        .map((session) => {
          const dealId = toTrimmed(session?.deal_id);
          const pipeline =
            toTrimmed(session?.deals?.pipeline_label) ?? toTrimmed(session?.deals?.pipeline_id);
          const organizationName = toTrimmed(session?.deals?.organizations?.name);
          const productTags = Array.isArray(session?.deal_products)
            ? session.deal_products
                .map((p: any) => toTrimmed(p?.name) ?? toTrimmed(p?.code))
                .filter((tag: string | null): tag is string => Boolean(tag))
            : [];

          return {
            id: toTrimmed(session?.id),
            dealId,
            sessionName: toTrimmed(session?.nombre_cache),
            pipeline,
            organizationName,
            productTags,
          };
        })
        .filter((session) => session.id && session.dealId);

      return successResponse({ sesiones });
    }

    // Sessions by deal (lightweight)
    if (method === 'GET' && isDealSessionsRequest) {
      const dealId = toTrimmed(event.queryStringParameters?.dealId);
      if (!dealId) return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);

      const sesiones = await prisma.sesiones.findMany({
        where: { deal_id: dealId },
        orderBy: [{ fecha_inicio_utc: 'asc' }, { created_at: 'asc' }],
        select: { id: true, fecha_inicio_utc: true, fecha_fin_utc: true,
  salas: { select: ({ sala_id: true, name: true, sede: true } as any) } },
      });

      const payload = (sesiones as any[]).map((s: any) => ({
        id: s.id as string,
        fecha_inicio_utc: toIsoOrNull(s.fecha_inicio_utc),
        fecha_fin_utc: toIsoOrNull(s.fecha_fin_utc),
        room: s.salas ? { id: (s.salas.sala_id as string) ?? null, name: (s.salas.name as string) ?? null } : null,
      }));

      return successResponse({ sesiones: payload });
    }

    // Range query
    if (method === 'GET' && isRangeRequest) {
      const startParam = toTrimmed(event.queryStringParameters?.start);
      if (!startParam) return errorResponse('VALIDATION_ERROR', 'El parámetro start es obligatorio', 400);
      const startResult = parseDateInput(startParam);
      if (startResult && 'error' in startResult) return startResult.error;
      const startDate = startResult as Date | null | undefined;
      if (!startDate) return errorResponse('VALIDATION_ERROR', 'El parámetro start es inválido', 400);

      const endParam = toTrimmed(event.queryStringParameters?.end);
      const endResult = endParam === null ? null : parseDateInput(endParam ?? undefined);
      if (endResult && typeof endResult === 'object' && 'error' in endResult) return endResult.error;
      const endDate = endResult === undefined ? null : ((endResult as Date | null | undefined) ?? null);

      const range = normalizeDateRange(startDate, endDate ?? startDate);
      if (!range) return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);

      const maxRangeMs = 120 * 24 * 60 * 60 * 1000;
      if (range.end.getTime() - range.start.getTime() > maxRangeMs) {
        return errorResponse('VALIDATION_ERROR', 'El rango máximo permitido es de 120 días', 400);
      }

      const dealFilter = toTrimmed(event.queryStringParameters?.dealId);
      const productFilter = toTrimmed(event.queryStringParameters?.productId);
      const salaFilter = toTrimmed(event.queryStringParameters?.roomId);
      const trainerFilter = toTrimmed(event.queryStringParameters?.trainerId);
      const unidadFilter = toTrimmed(event.queryStringParameters?.unitId);
      const estadoParam = toTrimmed(event.queryStringParameters?.estado);

      let estadoFilters: SessionEstado[] | null = null;
      if (estadoParam) {
        const values = estadoParam
          .split(',')
          .map((v) => toSessionEstado(v))
          .filter((v): v is SessionEstado => !!v);
        estadoFilters = values.length ? values : null;
      }

      const sesiones = await prisma.sesiones.findMany({
        where: {
          fecha_inicio_utc: { not: null },
          fecha_fin_utc: { not: null },
          ...(dealFilter ? { deal_id: dealFilter } : {}),
          ...(productFilter ? { deal_product_id: productFilter } : {}),
          ...(salaFilter ? { sala_id: salaFilter } : {}),
          ...(trainerFilter ? { sesion_trainers: { some: { trainer_id: trainerFilter } } } : {}),
          ...(unidadFilter ? { sesion_unidades: { some: { unidad_movil_id: unidadFilter } } } : {}),
          ...(estadoFilters
            ? estadoFilters.length === 1
              ? { estado: estadoFilters[0] }
              : { estado: { in: estadoFilters } }
            : {}),
          AND: [
            {
              OR: [
                { fecha_inicio_utc: { gte: range.start, lte: range.end } },
                { fecha_fin_utc: { gte: range.start, lte: range.end } },
                { AND: [{ fecha_inicio_utc: { lte: range.start } }, { fecha_fin_utc: { gte: range.end } }] },
              ],
            },
          ],
        },
        include: {
          deals: {
            select: {
              deal_id: true,
              title: true,
              training_address: true,
              pipeline_id: true,
              sede_label: true,
              caes_label: true,
              fundae_label: true,
              hotel_label: true,
              transporte: true,
              organizations: { select: { name: true } },
            },
          },
          deal_products: { select: { id: true, name: true, code: true } },
          salas: { select: ({ sala_id: true, name: true, sede: true } as any) },
          sesion_trainers: {
            select: { trainer_id: true, trainers: { select: { trainer_id: true, name: true, apellido: true } } },
          },
          sesion_unidades: {
            select: { unidad_movil_id: true, unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } } },
          },
          alumnos: { select: { id: true, nombre: true, apellido: true, dni: true } },
          _count: { select: { alumnos: true } },
        },
        orderBy: [{ fecha_inicio_utc: "asc" }],
      });

      const rowsAny = ensureSessionRelationsList(sesiones as any[]);
      const rowsById = new Map<string, any>(rowsAny.map((row: any) => [row.id as string, row]));

      const payload = rowsAny
        .map((s: any) => normalizeSession(s as unknown as SessionRecord))
        .filter((s: any) => s.fecha_inicio_utc && s.fecha_fin_utc)
        .map((s: any) => {
          const raw: any = rowsById.get(s.id);
          const salas = raw?.salas
  ? { sala_id: raw.salas.sala_id as string, name: raw.salas.name as string, sede: (raw.salas.sede as string) ?? null }
  : null;

          const trainers = ((raw?.trainers ?? []) as any[])
            .map((l: any) =>
              l.trainers
                ? {
                    trainer_id: l.trainers.trainer_id as string,
                    name: (l.trainers.name as string) ?? null,
                    apellido: (l.trainers.apellido as string) ?? null,
                  }
                : null,
            )
            .filter(
              (v: any): v is { trainer_id: string; name: string | null; apellido: string | null } => !!v,
            );

          const unidades = ((raw?.unidades ?? []) as any[])
            .map((l: any) =>
              l.unidades_moviles
                ? {
                    unidad_id: l.unidades_moviles.unidad_id as string,
                    name: (l.unidades_moviles.name as string) ?? null,
                    matricula: (l.unidades_moviles.matricula as string) ?? null,
                  }
                : null,
            )
            .filter((v: any): v is NonNullable<typeof v> => v != null);

          const students = Array.isArray(raw?.alumnos)
            ? (raw.alumnos as SessionStudentRecord[])
                .map((student) => mapSessionStudentForResponse(student))
                .filter((student): student is SessionStudentResponse => student !== null)
            : [];

          const studentsCountRaw = raw?._count?.alumnos;
          let studentsTotal =
            typeof studentsCountRaw === 'number' && Number.isFinite(studentsCountRaw)
              ? studentsCountRaw
              : null;
          if (studentsTotal === null && students.length) {
            studentsTotal = students.length;
          }

          return {
            id: s.id as string,
            deal_id: s.deal_id as string,
            deal_title: (raw?.deals?.title as string) ?? null,
            deal_organization_name: (raw?.deals?.organizations?.name as string) ?? null,
            deal_training_address: (raw?.deals?.training_address as string) ?? null,
            deal_sede_label: (raw?.deals?.sede_label as string) ?? null,
            deal_product_id: s.deal_product_id as string,
            product_name: (raw?.deal_product?.name as string) ?? null,
            product_code: (raw?.deal_product?.code as string) ?? null,
            nombre_cache: s.nombre_cache as string,
            fecha_inicio_utc: s.fecha_inicio_utc as string,
            fecha_fin_utc: s.fecha_fin_utc as string,
            direccion: s.direccion as string,
            estado: s.estado as SessionEstado,
            deal_pipeline_id: (raw?.deals?.pipeline_id as string) ?? null,
            deal_caes_label: (raw?.deals?.caes_label as string) ?? null,
            deal_fundae_label: (raw?.deals?.fundae_label as string) ?? null,
            deal_hotel_label: (raw?.deals?.hotel_label as string) ?? null,
            deal_transporte: (raw?.deals?.transporte as string) ?? null,
            salas,
            trainers,
            unidades,
            students,
            students_total: studentsTotal,
          };
        });

      return successResponse({ range: { start: range.start.toISOString(), end: range.end.toISOString() }, sesiones: payload });
    }

    // Counts for a single session
    if (method === 'GET' && isCountsRequest && sessionIdFromPath) {
      const existing = await prisma.sesiones.findUnique({ where: { id: sessionIdFromPath }, select: { id: true } });
      if (!existing) return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);

      const [comentarios, documentos, alumnos, tokens] = await prisma.$transaction([
        prisma.sesiones_comentarios.count({ where: { sesion_id: sessionIdFromPath } }),
        prisma.sesion_files.count({ where: { sesion_id: sessionIdFromPath } }),
        prisma.alumnos.count({ where: { sesion_id: sessionIdFromPath } }),
        prisma.tokens.count({ where: { session_id: sessionIdFromPath, active: true } }),
      ]);
      return successResponse({ comentarios, documentos, alumnos, tokens });
    }

    // List by deal (grouped by product)
    // List by deal (grouped by product)  OR  Calendar mode sin dealId
if (method === 'GET') {
  // Si viene en “modo calendario”, devolvemos sesiones por rango SIN exigir dealId
  if (isCalendarMode) {
    const range = getCalendarRangeFromQuery(query);
    if (!range) return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);

    const sesiones = await prisma.sesiones.findMany({
      where: {
        fecha_inicio_utc: { not: null },
        fecha_fin_utc: { not: null },
        AND: [
          {
            OR: [
              { fecha_inicio_utc: { gte: range.from, lte: range.to } },
              { fecha_fin_utc:    { gte: range.from, lte: range.to } },
              { AND: [{ fecha_inicio_utc: { lte: range.from } }, { fecha_fin_utc: { gte: range.to } }] },
            ],
          },
        ],
      },
      include: {
        deals: {
          select: {
            deal_id: true,
            title: true,
            training_address: true,
            pipeline_id: true,
            sede_label: true,
            caes_label: true,
            fundae_label: true,
            hotel_label: true,
            transporte: true,
            organizations: { select: { name: true } },
          },
        },
        deal_products: { select: { id: true, name: true, code: true } },
        salas: { select: ({ sala_id: true, name: true, sede: true } as any) },
        sesion_trainers: {
          select: { trainer_id: true, trainers: { select: { trainer_id: true, name: true, apellido: true } } },
        },
        sesion_unidades: {
          select: { unidad_movil_id: true, unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } } },
        },
        alumnos: { select: { id: true, nombre: true, apellido: true, dni: true } },
        _count: { select: { alumnos: true } },
      },
      orderBy: [{ fecha_inicio_utc: "asc" }],
    });

    const rowsAny = ensureSessionRelationsList(sesiones as any[]);
    const rowsById = new Map<string, any>(rowsAny.map((row: any) => [row.id as string, row]));

    const payload = rowsAny
      .map((s: any) => normalizeSession(s as unknown as SessionRecord))
      .filter((s: any) => s.fecha_inicio_utc && s.fecha_fin_utc)
      .map((s: any) => {
        const raw: any = rowsById.get(s.id);
        const salas = raw?.salas
          ? { sala_id: raw.salas.sala_id as string, name: raw.salas.name as string, sede: (raw.salas.sede as string) ?? null }
          : null;

        const trainers = ((raw?.trainers ?? []) as any[])
          .map((l: any) =>
            l.trainers
              ? {
                  trainer_id: l.trainers.trainer_id as string,
                  name: (l.trainers.name as string) ?? null,
                  apellido: (l.trainers.apellido as string) ?? null,
                }
              : null,
          )
          .filter((v: any): v is { trainer_id: string; name: string | null; apellido: string | null } => !!v);

        const unidades = ((raw?.unidades ?? []) as any[])
          .map((l: any) =>
            l.unidades_moviles
              ? {
                  unidad_id: l.unidades_moviles.unidad_id as string,
                  name: (l.unidades_moviles.name as string) ?? null,
                  matricula: (l.unidades_moviles.matricula as string) ?? null,
                }
              : null,
          )
          .filter((v: any): v is NonNullable<typeof v> => v != null);

        const students = Array.isArray(raw?.alumnos)
          ? (raw.alumnos as SessionStudentRecord[])
              .map((student) => mapSessionStudentForResponse(student))
              .filter((student): student is SessionStudentResponse => student !== null)
          : [];

        const studentsCountRaw = raw?._count?.alumnos;
        let studentsTotal =
          typeof studentsCountRaw === 'number' && Number.isFinite(studentsCountRaw)
            ? studentsCountRaw
            : null;
        if (studentsTotal === null && students.length) {
          studentsTotal = students.length;
        }

        return {
          id: s.id as string,
          deal_id: s.deal_id as string,
          deal_title: (raw?.deals?.title as string) ?? null,
          deal_organization_name: (raw?.deals?.organizations?.name as string) ?? null,
          deal_training_address: (raw?.deals?.training_address as string) ?? null,
          deal_sede_label: (raw?.deals?.sede_label as string) ?? null,
          deal_product_id: s.deal_product_id as string,
          product_name: (raw?.deal_product?.name as string) ?? null,
          product_code: (raw?.deal_product?.code as string) ?? null,
          nombre_cache: s.nombre_cache as string,
          fecha_inicio_utc: s.fecha_inicio_utc as string,
          fecha_fin_utc: s.fecha_fin_utc as string,
          direccion: s.direccion as string,
          estado: s.estado as SessionEstado,
          deal_pipeline_id: (raw?.deals?.pipeline_id as string) ?? null,
          deal_caes_label: (raw?.deals?.caes_label as string) ?? null,
          deal_fundae_label: (raw?.deals?.fundae_label as string) ?? null,
          deal_hotel_label: (raw?.deals?.hotel_label as string) ?? null,
          deal_transporte: (raw?.deals?.transporte as string) ?? null,
          salas,
          trainers,
          unidades,
          students,
          students_total: studentsTotal,
        };
      });

    return successResponse({
      range: { start: range.from.toISOString(), end: range.to.toISOString() },
      sesiones: payload,
    });
  }

  // --- flujo original por dealId (no tocar) ---
  const dealId = toTrimmed(event.queryStringParameters?.dealId);
  if (!dealId) return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);

  const productIdParam = toTrimmed(event.queryStringParameters?.productId);
  const page = Math.max(1, toPositiveInt(event.queryStringParameters?.page, 1));
  const limit = parseLimit(event.queryStringParameters?.limit);

  const response = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const deal = await tx.deals.findUnique({
      where: { deal_id: dealId },
      select: {
        deal_id: true,
        deal_products: { select: { id: true, code: true, name: true, quantity: true }, orderBy: [{ created_at: 'asc' }] },
      },
    });
    if (!deal) throw errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);

    const products = (deal.deal_products ?? []).filter((p: any) => hasApplicableCode(p?.code as any));
    const filteredProducts = productIdParam ? products.filter((p: { id: string }) => p.id === productIdParam) : products;

    const payload = await Promise.all(
      filteredProducts.map(async (product: any) => {
        const { total, rows } = await fetchSessionsByProduct(tx, deal.deal_id, product.id, page, limit);
        const mapped = (rows as any[]).map((r: any) => normalizeSession(r as unknown as SessionRecord));
        return {
          product: {
            id: product.id as string,
            code: product.code as string,
            name: product.name as string,
            quantity: toNonNegativeInt(product.quantity, 0),
          },
          sesiones: mapped,
          pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        };
      }),
    );

    return payload;
  });

  return successResponse({ groups: response });
}

    // Create
    if (method === 'POST' && !sessionIdFromPath) {
      const body = parseJson(event.body);
      const dealId = toTrimmed(body?.deal_id);
      const dealProductId = toTrimmed(body?.deal_product_id);
      if (!dealId || !dealProductId) return errorResponse('VALIDATION_ERROR', 'deal_id y deal_product_id son obligatorios', 400);

      const trainerIdsResult = ensureArrayOfStrings(body.trainer_ids);
      if (trainerIdsResult && 'error' in trainerIdsResult) return trainerIdsResult.error;
      const unidadIdsResult = ensureArrayOfStrings(body.unidad_movil_ids);
      if (unidadIdsResult && 'error' in unidadIdsResult) return unidadIdsResult.error;

      const fechaInicioResult = parseDateInput(body.fecha_inicio_utc);
      if (fechaInicioResult && 'error' in fechaInicioResult) return fechaInicioResult.error;
      const fechaFinResult = parseDateInput(body.fecha_fin_utc);
      if (fechaFinResult && 'error' in fechaFinResult) return fechaFinResult.error;
      const tiempoParadaResult = parseTiempoParada(body.tiempo_parada);
      if (tiempoParadaResult.error) return tiempoParadaResult.error;

      const rangeError = ensureValidDateRange(
        (fechaInicioResult as Date | null | undefined) ?? undefined,
        (fechaFinResult as Date | null | undefined) ?? undefined,
      );
      if (rangeError) return rangeError;

      const direccion = toOptionalText(body.direccion);
      const fechaInicioDate = fechaInicioResult === undefined ? null : (fechaInicioResult as Date | null);
      const fechaFinDate = fechaFinResult === undefined ? null : (fechaFinResult as Date | null);
      const salaId = toTrimmed(body.sala_id);
      const forceEstadoBorrador = shouldForceEstadoBorrador(body.force_estado_borrador);
      const tiempoParadaValue = 'value' in tiempoParadaResult ? tiempoParadaResult.value : undefined;

      const auditUserIdPromise = resolveUserIdFromEvent(event, prisma);

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const deal = await tx.deals.findUnique({
          where: { deal_id: dealId },
          select: { deal_id: true, training_address: true, sede_label: true, pipeline_id: true },
        });
        if (!deal) throw errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);

        const product = await tx.deal_products.findUnique({
          where: { id: dealProductId },
          select: { id: true, deal_id: true, name: true, code: true },
        });
        if (!product || product.deal_id !== deal.deal_id) throw errorResponse('NOT_FOUND', 'Producto del presupuesto no encontrado', 404);

        const baseName = buildNombreBase(product.name, product.code);

        await ensureResourcesAvailable(tx, {
          trainerIds: (trainerIdsResult as string[]).length ? (trainerIdsResult as string[]) : undefined,
          unidadIds: (unidadIdsResult as string[]).length ? (unidadIdsResult as string[]) : undefined,
          salaId: salaId ?? null,
          start: fechaInicioDate,
          end: fechaFinDate,
        });

        const autoEstado = computeAutomaticSessionEstadoFromValues({
          fechaInicio: fechaInicioDate,
          fechaFin: fechaFinDate,
          salaId: salaId ?? null,
          trainerIds: trainerIdsResult as string[],
          unidadIds: unidadIdsResult as string[],
          dealSede: deal.sede_label ?? null,
          dealPipeline: deal.pipeline_id ?? null,
        });

        const finalEstado = forceEstadoBorrador ? 'BORRADOR' : autoEstado;

        // Construimos un unchecked create para evitar el XOR con relaciones anidadas
        const createData: Prisma.sesionesUncheckedCreateInput = {
          id: randomUUID(),
          deal_id: deal.deal_id,
          deal_product_id: product.id,
          nombre_cache: baseName,
          direccion: direccion ?? deal.training_address ?? '',
          sala_id: salaId ?? null,
          estado: finalEstado,
        };

        // Solo añadimos las fechas si vienen definidas (no mandar undefined)
        if (fechaInicioResult !== undefined) {
          createData.fecha_inicio_utc = fechaInicioDate as Date | null;
        }
        if (fechaFinResult !== undefined) {
          createData.fecha_fin_utc = fechaFinDate as Date | null;
        }
        if (tiempoParadaValue !== undefined) {
          createData.tiempo_parada = tiempoParadaValue;
        }

        const created = await tx.sesiones.create({
          data: createData,
        });

        if ((trainerIdsResult as string[]).length) {
          await tx.sesion_trainers.createMany({
            data: (trainerIdsResult as string[]).map((trainerId: string) => ({
              sesion_id: created.id,
              trainer_id: trainerId,
            })),
          });
        }
        if ((unidadIdsResult as string[]).length) {
          await tx.sesion_unidades.createMany({
            data: (unidadIdsResult as string[]).map((unidadId: string) => ({
              sesion_id: created.id,
              unidad_movil_id: unidadId,
            })),
          });
        }

        await reindexSessionNames(tx, product.id, baseName);

        const storedRaw = await tx.sesiones.findUnique({
          where: { id: created.id },
          include: {
            deals: { select: { sede_label: true, pipeline_id: true } },
            sesion_trainers: { select: { trainer_id: true } },
            sesion_unidades: { select: { unidad_movil_id: true } },
            trainer_session_invites: { select: { trainer_id: true, status: true, sent_at: true, responded_at: true } },
          },
        });

        return normalizeSession(ensureSessionRelations(storedRaw as any));
      });

      const auditUserId = await auditUserIdPromise;
        const auditAfter = {
          id: result.id,
          deal_id: result.deal_id,
          deal_product_id: result.deal_product_id,
          estado: result.estado,
          fecha_inicio_utc: result.fecha_inicio_utc,
          fecha_fin_utc: result.fecha_fin_utc,
          tiempo_parada: result.tiempo_parada,
          sala_id: result.sala_id,
          direccion: result.direccion,
          trainer_ids: result.trainer_ids,
          unidad_movil_ids: result.unidad_movil_ids,
        };

      await logAudit({
        userId: auditUserId,
        action: 'session.created',
        entityType: 'session',
        entityId: result.id,
        before: null,
        after: auditAfter as JsonValue,
      });

      return successResponse({ session: result }, 201);
    }

    // Patch
    if (method === 'PATCH' && sessionIdFromPath) {
      const body = parseJson(event.body);
      const result = buildSessionPatch(body);
      if ('error' in result) return result.error;

      const trainerIds = result.trainerIds;
      const unidadIds = result.unidadIds;
      const data = result.data;
      const requestedEstado = result.estado;

      const storedRaw = await prisma.sesiones.findUnique({
        where: { id: sessionIdFromPath },
        include: {
          deals: { select: { sede_label: true, pipeline_id: true } },
          sesion_trainers: { select: { trainer_id: true } },
          sesion_unidades: { select: { unidad_movil_id: true } },
          trainer_session_invites: { select: { trainer_id: true, status: true, sent_at: true, responded_at: true } },
        },
      });
      const storedRecord = ensureSessionRelationsOrNull(storedRaw as any);
      if (!storedRecord) return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);

      const auditUserIdPromise = resolveUserIdFromEvent(event, prisma);
      const auditBeforeSnapshot = buildSessionAuditSnapshot(normalizeSession(storedRecord));

      const fechaInicio = (data as any).fecha_inicio_utc === undefined ? storedRecord.fecha_inicio_utc : ((data as any).fecha_inicio_utc as Date | null);
      const fechaFin = (data as any).fecha_fin_utc === undefined ? storedRecord.fecha_fin_utc : ((data as any).fecha_fin_utc as Date | null);
      const rangeError = ensureValidDateRange(fechaInicio, fechaFin);
      if (rangeError) return rangeError;

      const nextTrainerIds = trainerIds === undefined ? storedRecord.trainers.map((e) => e.trainer_id) : trainerIds;
      const nextUnidadIds = unidadIds === undefined ? storedRecord.unidades.map((e) => e.unidad_id) : unidadIds;

      let nextSalaId = storedRecord.sala_id as string | null;
      if (Object.prototype.hasOwnProperty.call(data, 'sala_id')) {
        const rawSala = (data as Record<string, any>).sala_id as any;
        nextSalaId = rawSala && typeof rawSala === 'object' && Object.prototype.hasOwnProperty.call(rawSala, 'set')
          ? ((rawSala.set as string | null | undefined) ?? null)
          : ((rawSala as string | null | undefined) ?? null);
      }

      const storedEstado = toSessionEstado(storedRecord.estado);
      const currentEstado = storedEstado ?? 'BORRADOR';
      const autoEstado = computeAutomaticSessionEstadoFromValues({
        fechaInicio,
        fechaFin,
        salaId: nextSalaId,
        trainerIds: nextTrainerIds as string[],
        unidadIds: nextUnidadIds as string[],
        dealSede: storedRecord.deal?.sede_label ?? null,
        dealPipeline: storedRecord.deal?.pipeline_id ?? null,
      });

      if (requestedEstado !== undefined) {
        const isCurrentManual = isManualSessionEstado(currentEstado);
        const allowsBorradorToManual = currentEstado === 'BORRADOR' && isBorradorTransitionEstado(requestedEstado);
        const allowsManualToBorrador = requestedEstado === 'BORRADOR' && isBorradorTransitionEstado(currentEstado);

        const matchesAutomaticEstado = requestedEstado === autoEstado;
        if (!isManualSessionEstado(requestedEstado) && !allowsManualToBorrador && !matchesAutomaticEstado) {
          return errorResponse('VALIDATION_ERROR', 'Estado no editable', 400);
        }
        if (!isCurrentManual && !allowsBorradorToManual && autoEstado !== 'PLANIFICADA') {
          return errorResponse('VALIDATION_ERROR', 'La sesión debe estar planificada para cambiar el estado', 400);
        }
        if (requestedEstado !== currentEstado) (data as Record<string, SessionEstado>).estado = requestedEstado;
      } else if (!isManualSessionEstado(currentEstado) && currentEstado !== autoEstado) {
        (data as Record<string, SessionEstado>).estado = autoEstado;
      }

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await ensureResourcesAvailable(tx, {
          sessionId: sessionIdFromPath,
          trainerIds: nextTrainerIds as string[],
          unidadIds: nextUnidadIds as string[],
          salaId: nextSalaId,
          start: fechaInicio,
          end: fechaFin,
        });

        const patch = await tx.sesiones.update({ where: { id: sessionIdFromPath }, data });

        if (trainerIds !== undefined) {
          await tx.sesion_trainers.deleteMany({ where: { sesion_id: sessionIdFromPath } });
          if ((trainerIds as string[]).length) {
            await tx.sesion_trainers.createMany({
              data: (trainerIds as string[]).map((trainerId: string) => ({
                sesion_id: sessionIdFromPath,
                trainer_id: trainerId,
              })),
            });
          }
        }
        if (unidadIds !== undefined) {
          await tx.sesion_unidades.deleteMany({ where: { sesion_id: sessionIdFromPath } });
          if ((unidadIds as string[]).length) {
            await tx.sesion_unidades.createMany({
              data: (unidadIds as string[]).map((unidadId: string) => ({
                sesion_id: sessionIdFromPath,
                unidad_movil_id: unidadId,
              })),
            });
          }
        }
        return patch;
      });

      const refreshedRaw = await prisma.sesiones.findUnique({
        where: { id: sessionIdFromPath },
        include: {
          deals: { select: { sede_label: true, pipeline_id: true } },
          sesion_trainers: { select: { trainer_id: true } },
          sesion_unidades: { select: { unidad_movil_id: true } },
          trainer_session_invites: { select: { trainer_id: true, status: true, sent_at: true, responded_at: true } },
        },
      });
      const refreshedRecord = ensureSessionRelationsOrNull(refreshedRaw as any);
      const normalizedSession = refreshedRecord ? normalizeSession(refreshedRecord) : null;

      if (!normalizedSession) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const auditAfterSnapshot = buildSessionAuditSnapshot(normalizedSession);
      const beforeJson = JSON.stringify(auditBeforeSnapshot);
      const afterJson = JSON.stringify(auditAfterSnapshot);

      if (beforeJson !== afterJson) {
        try {
          const auditUserId = await auditUserIdPromise;
          await logAudit({
            userId: auditUserId,
            action: 'session.updated',
            entityType: 'session',
            entityId: sessionIdFromPath,
            before: auditBeforeSnapshot as JsonValue,
            after: auditAfterSnapshot as JsonValue,
          });
        } catch (auditError) {
          console.error('[sessions] Failed to log session update', {
            sessionId: sessionIdFromPath,
            error: auditError,
          });
        }
      }

      return successResponse({ session: normalizedSession });
    }

    // Delete
    if (method === 'DELETE' && sessionIdFromPath) {
      const existing = await prisma.sesiones.findUnique({
        where: { id: sessionIdFromPath },
        select: { id: true, deal_product_id: true },
      });
      if (!existing) return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.sesion_trainers.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.sesion_unidades.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.sesion_files.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.sesiones_comentarios.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.alumnos.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.tokens.deleteMany({ where: { session_id: sessionIdFromPath } });

        await tx.sesiones.delete({ where: { id: sessionIdFromPath } });
        const product = await tx.deal_products.findUnique({
          where: { id: existing.deal_product_id },
          select: { id: true, name: true, code: true },
        });
        if (product) await reindexSessionNames(tx, product.id, buildNombreBase(product.name, product.code));
      });

      return successResponse({});
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in (error as any)) {
      return error as any;
    }
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
