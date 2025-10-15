import type { PrismaClient } from '@prisma/client';
import { errorResponse } from './response';

export function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
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
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function compareSessionsForOrder(
  a: { id: string; fecha_inicio_utc: Date | null; created_at: Date | null },
  b: { id: string; fecha_inicio_utc: Date | null; created_at: Date | null },
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
  return a.id.localeCompare(b.id);
}

export async function resolveSessionNumber(
  prisma: PrismaClient,
  session: any,
): Promise<string> {
  const persisted = extractPersistedSessionNumber(session);
  if (persisted) return persisted;

  const siblings = await prisma.sessions.findMany({
    where: { deal_id: session.deal_id },
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
  const session = await prisma.sessions.findUnique({
    where: { id: sessionId },
    include: {
      deal: {
        include: { organization: { select: { name: true } } },
      },
    },
  });

  if (!session) {
    return { error: errorResponse('NOT_FOUND', 'Sesión no encontrada', 404) };
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

  if (!session.deal) {
    const deal = await prisma.deals.findUnique({
      where: { deal_id: dealId },
      include: { organization: { select: { name: true } } },
    });
    if (!deal) {
      return { error: errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404) };
    }
    return { session: { ...session, deal } };
  }

  return { session };
}
