// backend/functions/calendar-organizations.ts
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

function toSearchTerm(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function toLimit(value: unknown, defaultValue: number, maxValue: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return defaultValue;
  }
  const normalized = Math.trunc(numberValue);
  if (normalized <= 0) {
    return defaultValue;
  }
  return Math.min(normalized, maxValue);
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
    }

    const prisma = getPrisma();
    const searchRaw = event.queryStringParameters?.search ?? event.queryStringParameters?.q ?? '';
    const search = toSearchTerm(searchRaw);
    const limitRaw = event.queryStringParameters?.limit;
    const take = toLimit(limitRaw, 25, 50);

    const organizations = await prisma.organizations.findMany({
      where: search
        ? {
            name: {
              contains: search,
              mode: 'insensitive' as const,
            },
          }
        : undefined,
      select: { name: true },
      orderBy: [{ name: 'asc' }],
      take,
    });

    const seen = new Set<string>();
    const names = organizations
      .map((organization: { name: string | null }) =>
        typeof organization?.name === 'string' ? organization.name.trim() : '',
      )
      .filter((name: string) => {
        if (!name.length) {
          return false;
        }
        const normalized = name.toLocaleLowerCase('es-ES');
        if (seen.has(normalized)) {
          return false;
        }
        seen.add(normalized);
        return true;
      });

    return successResponse({ organizations: names });
  } catch (error: any) {
    const message = typeof error?.message === 'string' && error.message.trim().length
      ? error.message
      : 'Error inesperado al buscar organizaciones';
    return errorResponse('UNKNOWN_ERROR', message, 500);
  }
};
