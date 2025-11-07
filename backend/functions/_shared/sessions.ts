import type { PrismaClient } from '@prisma/client';
import { errorResponse } from './response';

export function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

type SessionLike = {
  id?: unknown;
  number?: unknown;
  nombre?: unknown;
  nombre_cache?: unknown;
  direccion?: unknown;
  label?: unknown;
};

export function formatSessionLabel(session: SessionLike): string {
  const explicit = toStringOrNull(session.label);
  if (explicit) return explicit;

  const parts: string[] = [];
  const number = toStringOrNull(session.number);
  if (number) parts.push(`Sesión ${number}`);

  const nombre = toStringOrNull(session.nombre ?? session.nombre_cache);
  if (nombre) parts.push(nombre);

  if (!parts.length) {
    const id = toStringOrNull(session.id);
    if (id) parts.push(`Sesión ${id.slice(0, 8)}`);
  }

  const direccion = toStringOrNull(session.direccion);
  const base = parts.join(' – ');
  return `${base}${direccion ? ` (${direccion})` : ''}`.trim();
}

type EnsureSessionContextResult =
  | { session: any; error?: undefined }
  | { session?: undefined; error: ReturnType<typeof errorResponse> };

function extractPersistedSessionNumber(session: any): string | null {
  const candidates: unknown[] = [
    session?.numero,
    session?.numero_cache,
    session?.numero_sesion,
    session?.session_number,
    session?.orden,
    session?.order,
    session?.position,
  ];

  for (const candidate of candidates) {
    const value = toStringOrNull(candidate);
    if (value) return value;
  }

  const metadata = session?.metadata;
  if (metadata && typeof metadata === 'object') {
    const metaCandidate =
      toStringOrNull((metadata as any)?.numero) ||
      toStringOrNull((metadata as any)?.session_number);
    if (metaCandidate) return metaCandidate;
  }

  return null;
}

function toTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function compareSessionsForOrder(
  a: { id?: unknown; fecha_inicio_utc?: Date | string | null; created_at?: Date | string | null },
  b: { id?: unknown; fecha_inicio_utc?: Date | string | null; created_at?: Date | string | null },
): number {
  const startA = toTimestamp(a.fecha_inicio_utc);
  const startB = toTimestamp(b.fecha_inicio_utc);
  if (startA !== null && startB !== null && startA !== startB) {
    return startA - startB;
  }
  if (startA === null && startB !== null) return 1;
  if (startA !== null && startB === null) return -1;
  const createdA = toTimestamp(a.created_at) ?? 0;
  const createdB = toTimestamp(b.created_at) ?? 0;
  if (createdA !== createdB) return createdA - createdB;
  const idA = toStringOrNull(a.id) ?? '';
  const idB = toStringOrNull(b.id) ?? '';
  return idA.localeCompare(idB);
}

export async function resolveSessionNumber(
  prisma: PrismaClient,
  session: any,
): Promise<string> {
  const persisted = extractPersistedSessionNumber(session);
  if (persisted) return persisted;

  const siblings = await prisma.sesiones.findMany({
    where: { deal_id: session.deals_id },
    select: { id: true, fecha_inicio_utc: true, created_at: true },
  });

  if (!siblings.length) {
    return '1';
  }

  const sorted = siblings.slice().sort(compareSessionsForOrder);
  const index = sorted.findIndex((row: { id: string }) => row.id === session.id);
  return String(index >= 0 ? index + 1 : sorted.length + 1);
}

export async function ensureSessionContext(
  prisma: PrismaClient,
  dealId: string,
  sessionId: string,
): Promise<EnsureSessionContextResult> {
  const session = await prisma.sesiones.findUnique({
    where: { id: sessionId },
    include: {
      deals: {
        include: {
          organizations: { select: { org_id: true, name: true } },
        },
      },
    },
  });

  if (!session) {
    return { error: errorResponse('NOT_FOUND', 'Sesión no encontrada', 404) };
  }

  if ((session as any).deals && typeof (session as any).deals === 'object') {
    const dealRecord = (session as any).deals as Record<string, any>;
    if (!('organizations' in dealRecord) && 'organization' in dealRecord) {
      dealRecord.organizations = dealRecord.organization;
    }
  }

  if (session.deal_id !== dealId) {
    return {
      error: errorResponse(
        'VALIDATION_ERROR',
        'La sesión no pertenece al presupuesto indicado',
        400,
      ),
    };
  }

  if (!(session as any).deals) {
    const deal = await prisma.deals.findUnique({
      where: { deal_id: dealId },
      include: { organizations: { select: { org_id: true, name: true } } },
    });
    if (!deal) {
      return { error: errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404) };
    }

    if (typeof deal === 'object' && deal !== null) {
      const dealRecord = deal as Record<string, any>;
      if (!('organizations' in dealRecord) && 'organization' in dealRecord) {
        dealRecord.organizations = dealRecord.organization;
      }
    }
    return { session: { ...session, deal } };
  }

  return { session };
}
