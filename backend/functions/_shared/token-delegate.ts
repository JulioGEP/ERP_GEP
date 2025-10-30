import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;
export type TokensDelegate = PrismaClient['tokens'];

export function getTokensDelegate(client: PrismaClientLike | null | undefined): TokensDelegate | null {
  if (!client) return null;
  const tokens = (client as any)?.tokens;
  if (!tokens || typeof tokens !== 'object') return null;
  if (typeof tokens.count !== 'function') return null;
  return tokens as TokensDelegate;
}

export function hasTokensDelegate(client: PrismaClientLike | null | undefined): boolean {
  return getTokensDelegate(client) !== null;
}
