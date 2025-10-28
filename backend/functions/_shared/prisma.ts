import { PrismaClient } from '@prisma/client';
import { ensureMadridTimezone } from './timezone';

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

ensureMadridTimezone();

const globalForPrisma = globalThis as typeof globalThis & { _prisma?: PrismaClient };

export const prisma =
  globalForPrisma._prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? []
        : ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma._prisma = prisma;
}

export function getPrisma(): PrismaClient {
  return prisma;
}
