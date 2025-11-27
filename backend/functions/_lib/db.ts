// backend/functions/_lib/db.ts
import { PrismaClient } from '@prisma/client';
import { ensureMadridTimezone } from '../_shared/timezone';

type PrismaAliases = {
  sesiones: PrismaClient['sessions'];
  sesion_trainers: PrismaClient['session_trainers'];
  sesion_unidades: PrismaClient['session_unidades'];
  sesion_files: PrismaClient['session_files'];
};

ensureMadridTimezone();
const g = globalThis as unknown as { prisma?: PrismaClient };

function appendQueryParam(url: string | undefined, key: string, value: string) {
  if (!url) return url;

  if (url.includes(`${key}=`)) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${key}=${value}`;
}

const prismaUrl = appendQueryParam(process.env.DATABASE_URL, 'pgbouncer', 'true');

const prismaBase =
  g.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: prismaUrl,
      },
    },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

const prismaWithAliases = prismaBase as PrismaClient & PrismaAliases;
if (!(prismaWithAliases as any).sesiones) {
  (prismaWithAliases as any).sesiones = (prismaBase as any).sessions;
  (prismaWithAliases as any).sesion_trainers = (prismaBase as any).session_trainers;
  (prismaWithAliases as any).sesion_unidades = (prismaBase as any).session_unidades;
  (prismaWithAliases as any).sesion_files = (prismaBase as any).session_files;
}

export const prisma = prismaWithAliases;

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export function getPrisma(): PrismaClient {
  return prisma;
}
