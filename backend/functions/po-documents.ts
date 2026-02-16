import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import { formatSessionLabel } from './_shared/sessions';

const PO_DOCUMENT_PREFIX = 'PO - DOC - ';

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
      drive_file_name: {
        startsWith: PO_DOCUMENT_PREFIX,
      },
    },
    orderBy: { added_at: 'desc' },
    select: {
      id: true,
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
              organizations: { select: { name: true } },
            },
          },
        },
      },
      deals: {
        select: {
          organizations: { select: { name: true } },
        },
      },
    },
  });

  const poDocuments = documents.map((document) => {
    const session = document.sesiones;
    const sessionDateIso = session?.fecha_inicio_utc
      ? toMadridISOString(session.fecha_inicio_utc)
      : null;

    return {
      id: document.id,
      nombreDocumento: document.drive_file_name,
      enlaceDocumento: document.drive_web_view_link ?? null,
      empresa:
        session?.deals?.organizations?.name ??
        document.deals?.organizations?.name ??
        null,
      sesion:
        formatSessionLabel({
          id: session?.id,
          nombre_cache: session?.nombre_cache,
          direccion: session?.direccion,
        }) || session?.nombre_cache || null,
      fechaSesion: sessionDateIso,
      fechaRegistro: document.added_at ? toMadridISOString(document.added_at) : null,
    };
  });

  return successResponse({ documents: poDocuments });
});

export default handler;
