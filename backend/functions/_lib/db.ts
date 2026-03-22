// backend/functions/_lib/db.ts
import { PrismaClient } from '@prisma/client';
import { ensureMadridTimezone } from '../_shared/timezone';

ensureMadridTimezone();
const g = globalThis as unknown as { prisma?: PrismaClient; prismaDirect?: PrismaClient };

function appendQueryParam(url: string | undefined, key: string, value: string) {
  if (!url) return url;

  if (url.includes(`${key}=`)) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${key}=${value}`;
}

const prismaUrl = appendQueryParam(process.env.DATABASE_URL, 'pgbouncer', 'true');
const directPrismaUrl = process.env.DIRECT_URL;

export const prisma =
  g.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: prismaUrl,
      },
    },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export function getPrisma(): PrismaClient {
  return prisma;
}

function getDirectPrisma(): PrismaClient {
  if (!directPrismaUrl?.trim().length) {
    throw new Error('No existe DIRECT_URL para reintentar la conexión a la base de datos.');
  }

  if (g.prismaDirect) {
    return g.prismaDirect;
  }

  const client = new PrismaClient({
    datasources: {
      db: {
        url: directPrismaUrl,
      },
    },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

  if (process.env.NODE_ENV !== 'production') {
    g.prismaDirect = client;
  }

  return client;
}

function shouldRetryWithDirectUrl(error: unknown): boolean {
  if (!directPrismaUrl?.trim().length) {
    return false;
  }

  if (directPrismaUrl === prismaUrl) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes("Can't reach database server") || message.includes('P1001');
}

export async function withDatabaseFallback<T>(
  operation: (client: PrismaClient) => Promise<T>,
  context: { operationName: string },
): Promise<T> {
  try {
    return await operation(prisma);
  } catch (error) {
    if (!shouldRetryWithDirectUrl(error)) {
      throw error;
    }

    console.warn(`[db] Primary Prisma connection failed; retrying with DIRECT_URL for ${context.operationName}.`, {
      message: error instanceof Error ? error.message : String(error ?? ''),
    });

    return operation(getDirectPrisma());
  }
}
