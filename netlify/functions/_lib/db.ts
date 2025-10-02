import { PrismaClient } from '@prisma/client';
const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  g.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

export function getPrisma(): PrismaClient {
  return prisma;
}
