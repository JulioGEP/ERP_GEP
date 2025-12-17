// backend/functions/issued-certificates.ts
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { normalizeDriveUrl } from './_shared/drive';
import { toMadridISOString } from './_shared/timezone';

const PAGE_SIZE = 50;

function toTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parsePage(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function parseTrainingDate(value: unknown): { gte: Date; lt: Date } | null {
  const input = toTrimmed(value);
  if (!input) return null;

  const candidate = new Date(input);
  if (!Number.isFinite(candidate.getTime())) return null;

  const start = new Date(candidate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return { gte: start, lt: end };
}

function buildFilters(query: Record<string, string | undefined>): Prisma.alumnosWhereInput {
  const filters: Prisma.alumnosWhereInput[] = [{ certificado: true }];

  const presupuesto = toTrimmed(query.presupuesto);
  if (presupuesto) {
    filters.push({ OR: [{ deal_id: { contains: presupuesto, mode: 'insensitive' } }] });
  }

  const alumno = toTrimmed(query.alumno);
  if (alumno) {
    filters.push({
      OR: [
        { nombre: { contains: alumno, mode: 'insensitive' } },
        { apellido: { contains: alumno, mode: 'insensitive' } },
      ],
    });
  }

  const empresa = toTrimmed(query.empresa);
  if (empresa) {
    filters.push({ deals: { organizations: { name: { contains: empresa, mode: 'insensitive' } } } });
  }

  const formacion = toTrimmed(query.formacion);
  if (formacion) {
    filters.push({
      sesiones: {
        deal_products: { name: { contains: formacion, mode: 'insensitive' } },
      },
    });
  }

  const fecha = parseTrainingDate(query.fecha_formacion);
  if (fecha) {
    filters.push({ sesiones: { fecha_inicio_utc: fecha } });
  }

  return { AND: filters };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const page = parsePage(request.query.page);
  const where = buildFilters(request.query);

  const [total, students] = await Promise.all([
    prisma.alumnos.count({ where }),
    prisma.alumnos.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        deals: { select: { title: true, organizations: { select: { name: true } } } },
        sesiones: {
          select: {
            fecha_inicio_utc: true,
            deal_products: { select: { name: true } },
            nombre_cache: true,
          },
        },
      },
    }),
  ]);

  const items = students.map((student) => {
    const trainingDate = student.sesiones?.fecha_inicio_utc
      ? toMadridISOString(student.sesiones.fecha_inicio_utc)
      : null;

    return {
      id: student.id,
      presupuesto: student.deal_id,
      presupuesto_titulo: student.deals?.title ?? null,
      alumno_nombre: student.nombre,
      alumno_apellido: student.apellido,
      fecha_formacion: trainingDate,
      empresa: student.deals?.organizations?.name ?? null,
      formacion: student.sesiones?.deal_products?.name ?? student.sesiones?.nombre_cache ?? null,
      drive_url: normalizeDriveUrl(student.drive_url) ?? null,
    };
  });

  return successResponse({
    items,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: page * PAGE_SIZE < total,
    },
  });
});
