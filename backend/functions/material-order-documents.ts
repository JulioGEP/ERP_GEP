import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import {
  deleteMaterialOrderDocumentFromGoogleDrive,
  uploadMaterialOrderDocumentToGoogleDrive,
} from './_shared/googleDrive';
import { toMadridISOString } from './_shared/timezone';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

function parsePath(path: string) {
  const normalized = String(path || '');
  const trimmed = normalized.replace(/^\/?\.netlify\/functions\//, '/');
  const segments = trimmed.split('/').filter(Boolean);
  const documentId = segments[1] && segments[0] === 'material-order-documents' ? decodeURIComponent(segments[1]) : null;
  return { documentId };
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapDocument(row: any) {
  return {
    id: String(row.id),
    orderId: Number(row.order_id),
    fileName: row.file_name ?? 'Documento',
    mimeType: row.mime_type ?? null,
    fileSize: row.file_size ?? null,
    driveFileId: row.drive_file_id ?? null,
    driveFileName: row.drive_file_name ?? null,
    driveWebViewLink: row.drive_web_view_link ?? null,
    driveFolderId: row.drive_folder_id ?? null,
    createdAt: row.created_at ? toMadridISOString(row.created_at) : null,
    updatedAt: row.updated_at ? toMadridISOString(row.updated_at) : null,
  };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod;
    const prisma = getPrisma();
    const { documentId } = parsePath(event.path || '');

    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      const orderId = toNumberOrNull(params.orderId ?? params.order_id);

      if (!orderId) {
        return errorResponse('VALIDATION_ERROR', 'orderId es requerido', 400);
      }

      const documents = await prisma.material_order_documents.findMany({
        where: { order_id: orderId },
        orderBy: { created_at: 'desc' },
      });

      return successResponse({ documents: documents.map(mapDocument) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any = null;
      try {
        payload = JSON.parse(event.body);
      } catch {
        return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
      }

      const orderId = toNumberOrNull(payload?.orderId ?? payload?.order_id);
      const fileName = toStringOrNull(payload?.fileName ?? payload?.file_name);
      const mimeType = toStringOrNull(payload?.mimeType ?? payload?.mime_type);
      const contentBase64 = toStringOrNull(payload?.contentBase64 ?? payload?.content_base64);
      const fileSize = toNumberOrNull(payload?.fileSize ?? payload?.file_size);

      if (!orderId || !fileName || !contentBase64) {
        return errorResponse('VALIDATION_ERROR', 'orderId, fileName y contentBase64 son requeridos', 400);
      }

      const fileBuffer = Buffer.from(contentBase64, 'base64');
      if (!fileBuffer.length) {
        return errorResponse('VALIDATION_ERROR', 'Archivo inválido', 400);
      }

      if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
        return errorResponse('VALIDATION_ERROR', 'El archivo supera el tamaño máximo de 15MB', 400);
      }

      const order = await prisma.pedidos.findUnique({ where: { id: orderId } });
      if (!order) {
        return errorResponse('NOT_FOUND', 'Pedido no encontrado', 404);
      }

      const uploadResult = await uploadMaterialOrderDocumentToGoogleDrive({
        orderNumber: order.order_number,
        supplierName: order.supplier_name,
        fileName,
        mimeType,
        data: fileBuffer,
      });

      const document = await prisma.material_order_documents.create({
        data: {
          id: randomUUID(),
          order_id: orderId,
          file_name: fileName,
          mime_type: mimeType,
          file_size: fileSize ?? fileBuffer.length,
          drive_file_id: uploadResult.driveFileId,
          drive_file_name: uploadResult.driveFileName,
          drive_web_view_link: uploadResult.driveWebViewLink,
          drive_folder_id: uploadResult.driveFolderId,
        },
      });

      return successResponse({ document: mapDocument(document) }, 201);
    }

    if (method === 'DELETE' && documentId) {
      const existing = await prisma.material_order_documents.findUnique({ where: { id: documentId } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Documento no encontrado', 404);
      }

      await deleteMaterialOrderDocumentFromGoogleDrive({
        driveFileId: existing.drive_file_id,
        driveFileName: existing.drive_file_name,
        driveWebViewLink: existing.drive_web_view_link,
        driveFolderId: existing.drive_folder_id,
      });

      await prisma.material_order_documents.delete({ where: { id: documentId } });

      return successResponse({ deleted: true, id: documentId });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: any) {
    return errorResponse('UNEXPECTED', error?.message ?? 'Unexpected', 500);
  }
};
