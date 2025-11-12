import { createHash, randomBytes } from 'crypto';
import type { calendar_v3 } from 'googleapis';
import { google } from 'googleapis';
import { Prisma, PrismaClient } from '@prisma/client';
import { madridTimeZone, toMadridISOString } from './timezone';
import { buildMadridDateTime, formatTimeFromDb } from './time';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
] as const;

const RESOURCE_TYPE_SESSION = 'session';
const RESOURCE_TYPE_VARIANT = 'variant';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

export class TrainerCalendarError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'TrainerCalendarError';
  }
}

export type TrainerCalendarStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  totalEvents: number;
};

type CalendarConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type TrainerCredential = NonNullable<
  Awaited<ReturnType<PrismaClient['trainer_google_credentials']['findUnique']>>
>;

type SessionEventRecord = Awaited<
  ReturnType<PrismaClient['sesiones']['findUnique']>
> & {
  deal_products?: { name: string | null; code: string | null } | null;
  deals?: { deal_id: string | null; title: string | null; training_address: string | null } | null;
};

type VariantEventRecord = Awaited<
  ReturnType<PrismaClient['variants']['findUnique']>
> & {
  products?: { name: string | null; hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
};

type CalendarEventPayload = {
  summary: string;
  description?: string;
  location?: string;
  start: calendar_v3.Schema$EventDateTime;
  end: calendar_v3.Schema$EventDateTime;
  extendedProperties: {
    private?: {
      resourceType: string;
      resourceId: string;
    };
  };
};

type SyncAssignmentsOptions = {
  previousTrainerIds: readonly string[];
  nextTrainerIds: readonly string[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeIdList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!isNonEmptyString(value)) continue;
    const trimmed = value.trim();
    if (!trimmed.length || seen.has(trimmed)) continue;
    seen.add(trimmed);
  }
  return Array.from(seen);
}

function getCalendarConfig(): CalendarConfig {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new TrainerCalendarError(
      'CALENDAR_NOT_CONFIGURED',
      'La integración de Google Calendar no está configurada. Falta CLIENT_ID, CLIENT_SECRET o REDIRECT_URI.',
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export function isCalendarFeatureConfigured(): boolean {
  try {
    getCalendarConfig();
    return true;
  } catch {
    return false;
  }
}

function createOAuthClient(config?: CalendarConfig) {
  const cfg = config ?? getCalendarConfig();
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

function computeChecksum(payload: CalendarEventPayload): string {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

function buildSessionEventPayload(record: SessionEventRecord | null): CalendarEventPayload | null {
  if (!record) return null;
  const startIso = toMadridISOString(record.fecha_inicio_utc ?? null);
  const endIso = toMadridISOString(record.fecha_fin_utc ?? null);
  if (!startIso || !endIso) return null;

  const summaryBase = record.nombre_cache?.trim() || 'Sesión planificada';
  const descriptionLines: string[] = [];

  if (record.deal_products?.name) descriptionLines.push(`Formación: ${record.deal_products.name}`);
  if (record.deals?.title) descriptionLines.push(`Presupuesto: ${record.deals.title}`);
  if (record.deal_products?.code) descriptionLines.push(`Código producto: ${record.deal_products.code}`);
  if (record.deals?.deal_id) descriptionLines.push(`ID presupuesto: ${record.deals.deal_id}`);

  const description = descriptionLines.length ? descriptionLines.join('\n') : undefined;

  return {
    summary: summaryBase,
    description,
    location: record.direccion ?? undefined,
    start: { dateTime: startIso, timeZone: madridTimeZone() },
    end: { dateTime: endIso, timeZone: madridTimeZone() },
    extendedProperties: { private: { resourceType: RESOURCE_TYPE_SESSION, resourceId: String(record.id) } },
  };
}

type TimeParts = { hour: number; minute: number };

function extractTimeParts(value: Date | string | null | undefined): TimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

function computeVariantRange(record: VariantEventRecord | null): { start: Date; end: Date } | null {
  if (!record?.date) return null;
  const parsedDate = record.date instanceof Date ? record.date : new Date(record.date);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const startParts = extractTimeParts(record.products?.hora_inicio ?? null);
  const endParts = extractTimeParts(record.products?.hora_fin ?? null);
  const fallbackStart: TimeParts = startParts ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endParts ?? (startParts ? { ...startParts } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startParts, fallbackStart);
  let end = buildDateTime(parsedDate, endParts, fallbackEnd);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

function buildVariantEventPayload(record: VariantEventRecord | null): CalendarEventPayload | null {
  if (!record) return null;
  const range = computeVariantRange(record);
  if (!range) return null;

  const startIso = toMadridISOString(range.start);
  const endIso = toMadridISOString(range.end);
  if (!startIso || !endIso) return null;

  const name = record.name?.trim() || record.products?.name?.trim();
  const summary = name ? `Variante: ${name}` : 'Variante planificada';

  const descriptionLines: string[] = [];
  if (record.products?.name) descriptionLines.push(`Producto: ${record.products.name}`);
  if (record.sede) descriptionLines.push(`Sede: ${record.sede}`);
  if (record.id_padre) descriptionLines.push(`ID producto padre: ${record.id_padre}`);

  const description = descriptionLines.length ? descriptionLines.join('\n') : undefined;

  return {
    summary,
    description,
    location: record.sede ?? undefined,
    start: { dateTime: startIso, timeZone: madridTimeZone() },
    end: { dateTime: endIso, timeZone: madridTimeZone() },
    extendedProperties: { private: { resourceType: RESOURCE_TYPE_VARIANT, resourceId: String(record.id) } },
  };
}

function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const anyError = error as any;
    if (anyError.code === 404) return true;
    if (anyError.status === 404) return true;
    if (anyError.response?.status === 404) return true;
  }
  if (error instanceof Error) {
    return /not found/i.test(error.message);
  }
  return false;
}

function isUnauthorizedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  const anyError = error as any;
  const status = anyError?.code ?? anyError?.status ?? anyError?.response?.status;
  if (status === 401 || status === 403) return true;
  if (/invalid[_\s-]?grant/i.test(message)) return true;
  if (/invalid credentials/i.test(message)) return true;
  return false;
}

async function updateStoredTokens(
  prisma: PrismaClient,
  trainerId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; scope?: string | null; token_type?: string | null },
): Promise<void> {
  const data = {
    ...(tokens.access_token !== undefined ? { access_token: tokens.access_token ?? null } : {}),
    ...(tokens.scope !== undefined ? { scope: tokens.scope ?? null } : {}),
    ...(tokens.token_type !== undefined ? { token_type: tokens.token_type ?? null } : {}),
    ...(tokens.expiry_date !== undefined
      ? { expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date) : null }
      : {}),
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
  };

  if (Object.keys(data).length === 0) return;

  await prisma.trainer_google_credentials
    .update({ where: { trainer_id: trainerId }, data })
    .catch((error: unknown) => {
      console.error('[trainer-calendar] No se pudo actualizar tokens refrescados', { trainerId, error });
    });
}

async function withTrainerCalendar<T>(
  prisma: PrismaClient,
  trainerId: string,
  callback: (calendar: calendar_v3.Calendar, credential: TrainerCredential) => Promise<T>,
): Promise<T | null> {
  const credential = await prisma.trainer_google_credentials.findUnique({ where: { trainer_id: trainerId } });
  if (!credential) return null;

  if (!credential.refresh_token && !credential.access_token) {
    return null;
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: credential.access_token ?? undefined,
    refresh_token: credential.refresh_token ?? undefined,
    expiry_date: credential.expiry_date ? credential.expiry_date.getTime() : undefined,
    scope: credential.scope ?? undefined,
    token_type: credential.token_type ?? undefined,
  });

  client.on('tokens', (tokens) => {
    void updateStoredTokens(prisma, trainerId, tokens);
  });

  const calendar = google.calendar({ version: 'v3', auth: client });

  try {
    return await callback(calendar, credential);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      console.warn('[trainer-calendar] Tokens inválidos, se eliminarán las credenciales', { trainerId, error });
      await clearTrainerCalendar(prisma, trainerId);
      return null;
    }
    if (isNotFoundError(error)) {
      console.warn('[trainer-calendar] Recurso no encontrado al operar con Google Calendar', { trainerId, error });
      return null;
    }
    console.error('[trainer-calendar] Error inesperado llamando a Google Calendar', { trainerId, error });
    return null;
  }
}

async function deleteTrainerEventRecord(prisma: PrismaClient, trainerId: string, eventId: string): Promise<void> {
  await prisma.trainer_google_events
    .delete({ where: { id: eventId } })
    .catch((error: unknown) => {
      console.warn('[trainer-calendar] No se pudo eliminar el registro local del evento', { trainerId, eventId, error });
    });
}

async function clearTrainerCalendar(prisma: PrismaClient, trainerId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.trainer_google_events.deleteMany({ where: { trainer_id: trainerId } });
    await tx.trainer_google_credentials.delete({ where: { trainer_id: trainerId } }).catch(() => undefined);
    await tx.trainer_google_oauth_states.deleteMany({ where: { trainer_id: trainerId } }).catch(() => undefined);
  });
}

async function upsertTrainerEvent(
  prisma: PrismaClient,
  trainerId: string,
  resourceType: string,
  resourceId: string,
  payload: CalendarEventPayload,
): Promise<void> {
  await withTrainerCalendar(prisma, trainerId, async (calendar, credential) => {
    const calendarId = credential.calendar_id || 'primary';
    const resourceKey = { trainer_id: trainerId, resource_type: resourceType, resource_id: resourceId };
    const existing = await prisma.trainer_google_events.findUnique({ where: { trainer_id_resource_type_resource_id: resourceKey } });
    const checksum = computeChecksum(payload);

    if (existing && existing.checksum === checksum) {
      await prisma.trainer_google_events.update({
        where: { id: existing.id },
        data: { last_synced_at: new Date() },
      });
      return;
    }

    if (existing?.event_id) {
      const response = await calendar.events.update({
        calendarId,
        eventId: existing.event_id,
        requestBody: payload,
        sendUpdates: 'none',
      });

      const data = response.data;
      await prisma.trainer_google_events.update({
        where: { id: existing.id },
        data: {
          event_id: data.id ?? existing.event_id,
          etag: data.etag ?? null,
          checksum,
          last_synced_at: new Date(),
        },
      });
      return;
    }

    const response = await calendar.events.insert({
      calendarId,
      requestBody: payload,
      sendUpdates: 'none',
    });

    const data = response.data;
    await prisma.trainer_google_events.upsert({
      where: { trainer_id_resource_type_resource_id: resourceKey },
      create: {
        trainer_id: trainerId,
        resource_type: resourceType,
        resource_id: resourceId,
        event_id: data.id ?? '',
        etag: data.etag ?? null,
        checksum,
        last_synced_at: new Date(),
      },
      update: {
        event_id: data.id ?? '',
        etag: data.etag ?? null,
        checksum,
        last_synced_at: new Date(),
      },
    });
  });
}

async function deleteTrainerEvent(
  prisma: PrismaClient,
  trainerId: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  const existing = await prisma.trainer_google_events.findUnique({
    where: { trainer_id_resource_type_resource_id: { trainer_id: trainerId, resource_type: resourceType, resource_id: resourceId } },
  });
  if (!existing) return;

  await withTrainerCalendar(prisma, trainerId, async (calendar, credential) => {
    if (!existing.event_id) return;
    await calendar.events
      .delete({ calendarId: credential.calendar_id || 'primary', eventId: existing.event_id, sendUpdates: 'none' })
      .catch((error: unknown) => {
        if (!isNotFoundError(error)) {
          console.warn('[trainer-calendar] Error eliminando evento remoto', { trainerId, resourceType, resourceId, error });
        }
      });
  });

  await deleteTrainerEventRecord(prisma, trainerId, existing.id);
}

async function fetchSessionRecord(prisma: PrismaClient, sessionId: string): Promise<SessionEventRecord | null> {
  return prisma.sesiones.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      nombre_cache: true,
      direccion: true,
      fecha_inicio_utc: true,
      fecha_fin_utc: true,
      deal_products: { select: { name: true, code: true } },
      deals: { select: { deal_id: true, title: true, training_address: true } },
    },
  }) as Promise<SessionEventRecord | null>;
}

async function fetchVariantRecord(prisma: PrismaClient, variantId: string): Promise<VariantEventRecord | null> {
  return prisma.variants.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      sede: true,
      date: true,
      id_padre: true,
      products: { select: { name: true, hora_inicio: true, hora_fin: true } },
    },
  }) as Promise<VariantEventRecord | null>;
}

async function fetchVariantTrainerIds(prisma: PrismaClient, variantId: string): Promise<string[]> {
  const ids = new Set<string>();
  const variant = await prisma.variants.findUnique({ where: { id: variantId }, select: { trainer_id: true } });
  if (variant?.trainer_id) ids.add(variant.trainer_id);
  try {
    const rows = (await prisma.$queryRaw`SELECT trainer_id FROM variant_trainer_links WHERE variant_id = ${variantId}::uuid`) as Array<{ trainer_id: string | null }>;
    for (const row of rows) {
      if (isNonEmptyString(row.trainer_id)) ids.add(row.trainer_id.trim());
    }
  } catch (error) {
    if (!(error instanceof Error && /variant_trainer_links/i.test(error.message))) {
      throw error;
    }
  }
  return Array.from(ids);
}

async function fetchTrainerVariantIds(prisma: PrismaClient, trainerId: string): Promise<string[]> {
  const ids = new Set<string>();
  const direct = await prisma.variants.findMany({ where: { trainer_id: trainerId }, select: { id: true } });
  direct.forEach((entry: { id: string }) => ids.add(entry.id));
  try {
    const rows = (await prisma.$queryRaw`SELECT variant_id::text AS id FROM variant_trainer_links WHERE trainer_id = ${trainerId}`) as Array<{ id: string | null }>;
    for (const row of rows) {
      if (isNonEmptyString(row.id)) ids.add(row.id.trim());
    }
  } catch (error) {
    if (!(error instanceof Error && /variant_trainer_links/i.test(error.message))) {
      throw error;
    }
  }
  return Array.from(ids);
}

async function syncSessionForTrainer(prisma: PrismaClient, trainerId: string, sessionId: string): Promise<void> {
  const record = await fetchSessionRecord(prisma, sessionId);
  const payload = buildSessionEventPayload(record);
  if (!payload) {
    await deleteTrainerEvent(prisma, trainerId, RESOURCE_TYPE_SESSION, sessionId);
    return;
  }
  await upsertTrainerEvent(prisma, trainerId, RESOURCE_TYPE_SESSION, sessionId, payload);
}

async function syncVariantForTrainer(prisma: PrismaClient, trainerId: string, variantId: string): Promise<void> {
  const record = await fetchVariantRecord(prisma, variantId);
  const payload = buildVariantEventPayload(record);
  if (!payload) {
    await deleteTrainerEvent(prisma, trainerId, RESOURCE_TYPE_VARIANT, variantId);
    return;
  }
  await upsertTrainerEvent(prisma, trainerId, RESOURCE_TYPE_VARIANT, variantId, payload);
}

async function removeSessionForTrainer(prisma: PrismaClient, trainerId: string, sessionId: string): Promise<void> {
  await deleteTrainerEvent(prisma, trainerId, RESOURCE_TYPE_SESSION, sessionId);
}

async function removeVariantForTrainer(prisma: PrismaClient, trainerId: string, variantId: string): Promise<void> {
  await deleteTrainerEvent(prisma, trainerId, RESOURCE_TYPE_VARIANT, variantId);
}

async function performFullSync(prisma: PrismaClient, trainerId: string): Promise<void> {
  const credential = await prisma.trainer_google_credentials.findUnique({ where: { trainer_id: trainerId } });
  if (!credential) {
    throw new TrainerCalendarError('TRAINER_NOT_CONNECTED', 'El formador no tiene Google Calendar conectado.');
  }

  const sessions = await prisma.sesiones.findMany({
    where: { sesion_trainers: { some: { trainer_id: trainerId } } },
    select: { id: true },
  });
  const sessionIds = new Set<string>(sessions.map((entry: { id: string }) => entry.id));
  const variantIds = new Set<string>(await fetchTrainerVariantIds(prisma, trainerId));

  const existingEvents = await prisma.trainer_google_events.findMany({ where: { trainer_id: trainerId } });
  for (const event of existingEvents) {
    if (event.resource_type === RESOURCE_TYPE_SESSION && !sessionIds.has(event.resource_id)) {
      await deleteTrainerEvent(prisma, trainerId, event.resource_type, event.resource_id);
      continue;
    }
    if (event.resource_type === RESOURCE_TYPE_VARIANT && !variantIds.has(event.resource_id)) {
      await deleteTrainerEvent(prisma, trainerId, event.resource_type, event.resource_id);
    }
  }

  for (const sessionId of sessionIds) {
    await syncSessionForTrainer(prisma, trainerId, sessionId);
  }

  for (const variantId of variantIds) {
    await syncVariantForTrainer(prisma, trainerId, variantId);
  }

  await prisma.trainer_google_credentials.update({
    where: { trainer_id: trainerId },
    data: { last_synced_at: new Date() },
  });
}

export async function getTrainerIdForUser(prisma: PrismaClient, userId: string): Promise<string | null> {
  const trainer = await prisma.trainers.findUnique({ where: { user_id: userId }, select: { trainer_id: true } });
  return trainer?.trainer_id ?? null;
}

export async function getTrainerCalendarStatus(
  prisma: PrismaClient,
  trainerId: string,
): Promise<TrainerCalendarStatus> {
  if (!isCalendarFeatureConfigured()) {
    return {
      configured: false,
      connected: false,
      accountEmail: null,
      calendarId: null,
      lastSyncedAt: null,
      totalEvents: 0,
    };
  }

  const credential = await prisma.trainer_google_credentials.findUnique({ where: { trainer_id: trainerId } });
  const totalEvents = await prisma.trainer_google_events.count({ where: { trainer_id: trainerId } });

  return {
    configured: true,
    connected: Boolean(credential),
    accountEmail: credential?.email ?? null,
    calendarId: credential?.calendar_id ?? null,
    lastSyncedAt: credential?.last_synced_at ? credential.last_synced_at.toISOString() : null,
    totalEvents,
  };
}

export async function startTrainerCalendarOAuth(
  prisma: PrismaClient,
  trainerId: string,
  options: { returnTo?: string },
): Promise<string> {
  const config = getCalendarConfig();
  await prisma.trainer_google_oauth_states.deleteMany({ where: { trainer_id: trainerId, expires_at: { lt: new Date() } } });

  const state = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  const redirectUri = options.returnTo && options.returnTo.trim().length ? options.returnTo.trim() : '/perfil';

  await prisma.trainer_google_oauth_states.create({
    data: { state, trainer_id: trainerId, redirect_uri: redirectUri, expires_at: expiresAt },
  });

  const client = createOAuthClient(config);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: [...OAUTH_SCOPES],
    state,
  });
}

export async function completeTrainerCalendarOAuth(
  prisma: PrismaClient,
  state: string,
  code: string,
): Promise<{ redirectTo: string; success: boolean; error?: string }> {
  const stored = await prisma.trainer_google_oauth_states.findUnique({ where: { state } });
  if (!stored) {
    return { redirectTo: '/perfil', success: false, error: 'STATE_NOT_FOUND' };
  }
  if (stored.expires_at.getTime() < Date.now()) {
    await prisma.trainer_google_oauth_states.delete({ where: { state } }).catch(() => undefined);
    return { redirectTo: stored.redirect_uri || '/perfil', success: false, error: 'STATE_EXPIRED' };
  }

  const client = createOAuthClient();
  let tokens;
  try {
    const response = await client.getToken(code);
    tokens = response.tokens;
  } catch (error) {
    console.error('[trainer-calendar] Error intercambiando el código de OAuth', { trainerId: stored.trainer_id, error });
    await prisma.trainer_google_oauth_states.delete({ where: { state } }).catch(() => undefined);
    return { redirectTo: stored.redirect_uri || '/perfil', success: false, error: 'TOKEN_EXCHANGE_FAILED' };
  }

  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  try {
    const { data } = await oauth2.userinfo.get();
    const googleUserId = data.id;
    if (!googleUserId) {
      throw new Error('MISSING_GOOGLE_USER_ID');
    }

    await prisma.trainer_google_credentials.upsert({
      where: { trainer_id: stored.trainer_id },
      create: {
        trainer_id: stored.trainer_id,
        google_user_id: googleUserId,
        email: data.email ?? null,
        calendar_id: 'primary',
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token ?? null,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? null,
        expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        connected_at: new Date(),
        last_synced_at: null,
      },
      update: {
        google_user_id: googleUserId,
        email: data.email ?? null,
        access_token: tokens.access_token ?? null,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? null,
        expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      },
    });
  } catch (error) {
    console.error('[trainer-calendar] Error obteniendo información del usuario de Google', { trainerId: stored.trainer_id, error });
    await prisma.trainer_google_oauth_states.delete({ where: { state } }).catch(() => undefined);
    return { redirectTo: stored.redirect_uri || '/perfil', success: false, error: 'USERINFO_FAILED' };
  }

  await prisma.trainer_google_oauth_states.delete({ where: { state } }).catch(() => undefined);

  try {
    await performFullSync(prisma, stored.trainer_id);
    return { redirectTo: stored.redirect_uri || '/perfil', success: true };
  } catch (error) {
    console.error('[trainer-calendar] Error sincronizando tras la conexión inicial', { trainerId: stored.trainer_id, error });
    return { redirectTo: stored.redirect_uri || '/perfil', success: false, error: 'SYNC_FAILED' };
  }
}

export async function disconnectTrainerCalendar(prisma: PrismaClient, trainerId: string): Promise<void> {
  const credential = await prisma.trainer_google_credentials.findUnique({ where: { trainer_id: trainerId } });
  if (!credential) return;

  const events = await prisma.trainer_google_events.findMany({ where: { trainer_id: trainerId } });

  try {
    const client = createOAuthClient();
    client.setCredentials({
      access_token: credential.access_token ?? undefined,
      refresh_token: credential.refresh_token ?? undefined,
      expiry_date: credential.expiry_date ? credential.expiry_date.getTime() : undefined,
      scope: credential.scope ?? undefined,
      token_type: credential.token_type ?? undefined,
    });
    const calendar = google.calendar({ version: 'v3', auth: client });
    for (const event of events) {
      if (!event.event_id) continue;
      await calendar.events
        .delete({ calendarId: credential.calendar_id || 'primary', eventId: event.event_id, sendUpdates: 'none' })
        .catch((error: unknown) => {
          if (!isNotFoundError(error)) {
            console.warn('[trainer-calendar] No se pudo eliminar evento remoto durante la desconexión', {
              trainerId,
              eventId: event.event_id,
              error,
            });
          }
        });
    }
    if (credential.refresh_token) {
      await client.revokeToken(credential.refresh_token).catch((error: unknown) => {
        console.warn('[trainer-calendar] No se pudo revocar el token de Google', { trainerId, error });
      });
    }
  } catch (error) {
    console.warn('[trainer-calendar] Error al limpiar la cuenta de Google Calendar durante la desconexión', { trainerId, error });
  }

  await clearTrainerCalendar(prisma, trainerId);
}

export async function syncTrainerCalendar(prisma: PrismaClient, trainerId: string): Promise<void> {
  await performFullSync(prisma, trainerId);
}

export async function syncSessionAssignments(
  prisma: PrismaClient,
  sessionId: string,
  options: SyncAssignmentsOptions,
): Promise<void> {
  const previous = normalizeIdList(options.previousTrainerIds);
  const next = normalizeIdList(options.nextTrainerIds);

  const toRemove = previous.filter((id) => !next.includes(id));

  for (const trainerId of toRemove) {
    await removeSessionForTrainer(prisma, trainerId, sessionId);
  }

  for (const trainerId of next) {
    await syncSessionForTrainer(prisma, trainerId, sessionId);
  }
}

export async function removeSessionAssignments(
  prisma: PrismaClient,
  sessionId: string,
  trainerIds: readonly string[],
): Promise<void> {
  const normalized = normalizeIdList(trainerIds);
  for (const trainerId of normalized) {
    await removeSessionForTrainer(prisma, trainerId, sessionId);
  }
}

export async function syncVariantAssignments(
  prisma: PrismaClient,
  variantId: string,
  options: SyncAssignmentsOptions,
): Promise<void> {
  const previous = normalizeIdList(options.previousTrainerIds);
  const next = normalizeIdList(options.nextTrainerIds);

  const toRemove = previous.filter((id) => !next.includes(id));
  for (const trainerId of toRemove) {
    await removeVariantForTrainer(prisma, trainerId, variantId);
  }

  for (const trainerId of next) {
    await syncVariantForTrainer(prisma, trainerId, variantId);
  }
}

export async function removeVariantAssignments(
  prisma: PrismaClient,
  variantId: string,
  trainerIds: readonly string[],
): Promise<void> {
  const normalized = normalizeIdList(trainerIds);
  for (const trainerId of normalized) {
    await removeVariantForTrainer(prisma, trainerId, variantId);
  }
}

export async function getVariantTrainerIds(prisma: PrismaClient, variantId: string): Promise<string[]> {
  return fetchVariantTrainerIds(prisma, variantId);
}
