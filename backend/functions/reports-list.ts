// backend/functions/reports-list.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import { formatSessionLabel } from './_shared/sessions';

const formatTrainerName = (trainer: { name?: unknown; apellido?: unknown } | null | undefined) => {
  if (!trainer) return null;
  const name = typeof trainer.name === 'string' ? trainer.name.trim() : '';
  const lastName = typeof trainer.apellido === 'string' ? trainer.apellido.trim() : '';
  const full = [name, lastName].filter(Boolean).join(' ').trim();
  if (full.length) return full;
  if (name.length) return name;
  if (lastName.length) return lastName;
  return null;
};

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const documents = await prisma.sesion_files.findMany({
    where: {
      compartir_formador: true,
      file_type: 'pdf',
    },
    orderBy: { added_at: 'desc' },
    select: {
      id: true,
      deal_id: true,
      sesion_id: true,
      drive_file_name: true,
      drive_web_view_link: true,
      added_at: true,
      sesiones: {
        select: {
          id: true,
          nombre_cache: true,
          direccion: true,
          fecha_inicio_utc: true,
          deals: {
            select: {
              deal_id: true,
              organizations: { select: { name: true } },
            },
          },
          sesion_trainers: {
            select: {
              trainers: { select: { name: true, apellido: true } },
            },
          },
        },
      },
      deals: {
        select: {
          deal_id: true,
          organizations: { select: { name: true } },
        },
      },
    },
  });

  const reports = documents.map((doc) => {
    const session = doc.sesiones;
    const deal = doc.deals ?? session?.deals ?? null;
    const organizationName =
      deal?.organizations?.name ?? session?.deals?.organizations?.name ?? null;
    const trainerNames = Array.from(
      new Set(
        (session?.sesion_trainers || [])
          .map((item) => formatTrainerName(item?.trainers))
          .filter((name): name is string => Boolean(name)),
      ),
    );

    return {
      id: doc.id,
      presupuesto: deal?.deal_id ?? doc.deal_id,
      empresa: organizationName,
      sesion:
        formatSessionLabel({
          id: session?.id,
          nombre: session?.nombre_cache,
          nombre_cache: session?.nombre_cache,
          direccion: session?.direccion,
        }) || session?.nombre_cache || null,
      fecha: session?.fecha_inicio_utc ? toMadridISOString(session.fecha_inicio_utc) : null,
      formador: trainerNames.join(', ') || null,
      enlace: doc.drive_web_view_link ?? null,
      archivo: doc.drive_file_name ?? null,
      registrado_en: doc.added_at ? toMadridISOString(doc.added_at) : null,
    };
  });

  return successResponse({ reports });
});

export default handler;
