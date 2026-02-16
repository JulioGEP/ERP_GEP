import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';

type PoDocumentRow = {
  id: string;
  name: string;
  kind: 'presupuesto' | 'sesion';
  deal_id: string | null;
  session_id: string | null;
  session_name: string | null;
  session_date: string | null;
  company_name: string | null;
  created_at: string | null;
  url: string | null;
};

const PO_DOCUMENT_PREFIX = 'PO - DOC - ';

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
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

    const [dealDocuments, sessionDocuments] = await Promise.all([
      prisma.deal_files.findMany({
        where: {
          OR: [
            { file_name: { startsWith: PO_DOCUMENT_PREFIX, mode: 'insensitive' } },
            { drive_file_name: { startsWith: PO_DOCUMENT_PREFIX, mode: 'insensitive' } },
          ],
        },
        include: {
          deals: {
            include: {
              organizations: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: [{ added_at: 'desc' }, { created_at: 'desc' }],
      }),
      prisma.sesion_files.findMany({
        where: {
          drive_file_name: { startsWith: PO_DOCUMENT_PREFIX, mode: 'insensitive' },
        },
        include: {
          deals: {
            include: {
              organizations: {
                select: { name: true },
              },
            },
          },
          sesiones: {
            select: {
              id: true,
              nombre_cache: true,
              fecha_inicio_utc: true,
            },
          },
        },
        orderBy: [{ added_at: 'desc' }, { created_at: 'desc' }],
      }),
    ]);

    const rows: PoDocumentRow[] = [
      ...dealDocuments.map((document) => ({
        id: document.id,
        name: toStringOrNull(document.drive_file_name) ?? toStringOrNull(document.file_name) ?? 'Sin nombre',
        kind: 'presupuesto' as const,
        deal_id: toStringOrNull(document.deal_id),
        session_id: null,
        session_name: null,
        session_date: null,
        company_name: toStringOrNull(document.deals?.organizations?.name),
        created_at: document.added_at ? toMadridISOString(document.added_at) : null,
        url: toStringOrNull(document.drive_web_view_link) ?? toStringOrNull(document.file_url),
      })),
      ...sessionDocuments.map((document) => ({
        id: document.id,
        name: toStringOrNull(document.drive_file_name) ?? 'Sin nombre',
        kind: 'sesion' as const,
        deal_id: toStringOrNull(document.deal_id),
        session_id: toStringOrNull(document.sesion_id),
        session_name: toStringOrNull(document.sesiones?.nombre_cache),
        session_date: document.sesiones?.fecha_inicio_utc
          ? toMadridISOString(document.sesiones.fecha_inicio_utc)
          : null,
        company_name: toStringOrNull(document.deals?.organizations?.name),
        created_at: document.added_at ? toMadridISOString(document.added_at) : null,
        url: toStringOrNull(document.drive_web_view_link),
      })),
    ];

    rows.sort((left, right) => {
      const leftDate = toDateOrNull(left.created_at)?.getTime() ?? 0;
      const rightDate = toDateOrNull(right.created_at)?.getTime() ?? 0;
      return rightDate - leftDate;
    });

    return successResponse({ documents: rows });
  } catch (error) {
    console.error('[po_documents] Unexpected error', error);
    return errorResponse('INTERNAL_ERROR', 'No se pudieron obtener los documentos PO', 500);
  }
};
