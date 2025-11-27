// backend/functions/_lib/db.ts
import { PrismaClient } from '@prisma/client';
import { ensureMadridTimezone } from '../_shared/timezone';

ensureMadridTimezone();
const g = globalThis as unknown as { prisma?: PrismaClient };

function appendQueryParam(url: string | undefined, key: string, value: string) {
  if (!url) return url;

  if (url.includes(`${key}=`)) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${key}=${value}`;
}

const prismaUrl = appendQueryParam(process.env.DATABASE_URL, 'pgbouncer', 'true');

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
