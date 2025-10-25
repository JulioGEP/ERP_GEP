import { requestJson } from '../../../api/client';
import {
  ApiError,
  blobToBase64,
  normalizeDealDocument,
  normalizeSessionDocument,
  toStringArray,
  toStringValue,
} from './shared';
import type { DealDocument, Json, SessionDocument, SessionDocumentsPayload } from './types';

const MANUAL_INLINE_UPLOAD_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
const MANUAL_INLINE_UPLOAD_MAX_LABEL = '4.5 MB';
export const MANUAL_DOCUMENT_SIZE_LIMIT_BYTES = MANUAL_INLINE_UPLOAD_MAX_BYTES;
export const MANUAL_DOCUMENT_SIZE_LIMIT_LABEL = MANUAL_INLINE_UPLOAD_MAX_LABEL;
export const MANUAL_DOCUMENT_SIZE_LIMIT_MESSAGE = `Archivo demasiado pesado, máximo ${MANUAL_DOCUMENT_SIZE_LIMIT_LABEL}`;

export const SESSION_DOCUMENT_SIZE_LIMIT_BYTES = 4 * 1024 * 1024;
export const SESSION_DOCUMENT_SIZE_LIMIT_LABEL = '4 MB';
export const SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE = `Archivo demasiado pesado, máximo ${SESSION_DOCUMENT_SIZE_LIMIT_LABEL}`;

async function prepareDealDocumentUpload(
  dealId: string,
  file: File,
  headers: Record<string, string>,
): Promise<{ uploadUrl: string; storageKey: string }> {
  const payload = await requestJson<{ uploadUrl?: string; storageKey?: string }>(
    `/deal_documents/${encodeURIComponent(dealId)}/upload-url`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      }),
    },
  );

  const uploadUrl = toStringValue(payload?.uploadUrl);
  const storageKey = toStringValue(payload?.storageKey);
  if (!uploadUrl || !storageKey) {
    throw new ApiError('UPLOAD_PREPARE_ERROR', 'No se pudo preparar la subida del documento');
  }

  return { uploadUrl, storageKey };
}

async function uploadFileToUrl(uploadUrl: string, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo de red al subir el documento';
    throw new ApiError('NETWORK_ERROR', message);
  }

  if (!response.ok) {
    throw new ApiError(
      'UPLOAD_ERROR',
      'No se pudo subir el documento al almacenamiento',
      response.status,
    );
  }
}

export async function listDocuments(dealId: string): Promise<DealDocument[]> {
  const data = await requestJson<{ documents?: unknown[] }>(
    `/deal_documents/${encodeURIComponent(String(dealId))}`,
  );
  const docs: any[] = Array.isArray(data?.documents) ? (data.documents as unknown[]) : [];
  return docs.map((doc) => normalizeDealDocument(doc));
}

export async function getDocPreviewUrl(
  dealId: string,
  docId: string,
): Promise<{ url: string; name?: string | null; mime_type?: string | null }> {
  const data = await requestJson<{ url?: string; name?: string; mime_type?: string }>(
    `/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}/url`,
  );
  return {
    url: String(data?.url ?? ''),
    name: toStringValue(data?.name),
    mime_type: toStringValue(data?.mime_type),
  };
}

export async function uploadManualDocument(
  dealId: string,
  file: File,
  user?: { id: string; name?: string },
): Promise<void> {
  const normalizedId = String(dealId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'Falta dealId para subir el documento');
  }

  const headers: Record<string, string> = {};
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.name) headers['X-User-Name'] = user.name;

  if (file.size > MANUAL_INLINE_UPLOAD_MAX_BYTES) {
    try {
      const { uploadUrl, storageKey } = await prepareDealDocumentUpload(normalizedId, file, headers);
      await uploadFileToUrl(uploadUrl, file);

      await requestJson(`/deal_documents/${encodeURIComponent(normalizedId)}/manual`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          storageKey,
        }),
      });
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }
      // Fallback to inline upload below if S3 is not configured or request fails.
    }
  }

  const contentBase64 = await blobToBase64(file);
  await requestJson(`/deal_documents/${encodeURIComponent(normalizedId)}/manual`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      contentBase64,
    }),
  });
}

export async function deleteDocument(dealId: string, docId: string): Promise<void> {
  await requestJson(`/deal_documents/${encodeURIComponent(String(dealId))}/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
}

export async function fetchSessionDocuments(
  dealId: string,
  sessionId: string,
): Promise<SessionDocumentsPayload> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const params = new URLSearchParams({ deal_id: normalizedDealId, sesion_id: normalizedSessionId });
  const data = await requestJson<{ documents?: unknown[]; drive_url?: string; driveUrl?: string }>(
    `/session_documents?${params.toString()}`,
  );
  const docs: any[] = Array.isArray(data?.documents) ? data.documents : [];
  const driveUrl = toStringValue(data?.drive_url ?? data?.driveUrl) ?? null;
  return {
    documents: docs.map((doc) => normalizeSessionDocument(doc)),
    driveUrl,
  };
}

export async function uploadSessionDocuments(params: {
  dealId: string;
  sessionId: string;
  files: File[];
  shareWithTrainer: boolean;
}): Promise<SessionDocumentsPayload> {
  const normalizedDealId = String(params.dealId ?? '').trim();
  const normalizedSessionId = String(params.sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const files = Array.isArray(params.files) ? params.files : [];
  if (!files.length) {
    throw new ApiError('VALIDATION_ERROR', 'Selecciona al menos un archivo');
  }

  const oversizedFile = files.find((file) => file.size > SESSION_DOCUMENT_SIZE_LIMIT_BYTES);
  if (oversizedFile) {
    throw new ApiError('PAYLOAD_TOO_LARGE', SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE, 413);
  }

  const totalSize = files.reduce((sum, file) => sum + Math.max(0, file.size || 0), 0);
  if (totalSize > SESSION_DOCUMENT_SIZE_LIMIT_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE, 413);
  }

  const payloadFiles = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      contentBase64: await blobToBase64(file),
    })),
  );

  const data = await requestJson<{ documents?: unknown[]; drive_url?: string; driveUrl?: string }>(
    `/session_documents`,
    {
      method: 'POST',
      body: JSON.stringify({
        deal_id: normalizedDealId,
        sesion_id: normalizedSessionId,
        compartir_formador: params.shareWithTrainer,
        files: payloadFiles,
      }),
    },
  );

  const docs: any[] = Array.isArray(data?.documents) ? data.documents : [];
  const driveUrl = toStringValue(data?.drive_url ?? data?.driveUrl) ?? null;
  return {
    documents: docs.map((doc) => normalizeSessionDocument(doc)),
    driveUrl,
  };
}

export async function updateSessionDocumentShare(
  dealId: string,
  sessionId: string,
  documentId: string,
  shareWithTrainer: boolean,
): Promise<SessionDocument> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedDocumentId = String(documentId ?? '').trim();

  if (!normalizedDealId || !normalizedSessionId || !normalizedDocumentId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId, sessionId y documentId son obligatorios');
  }

  const data = await requestJson<{ document?: unknown }>(
    `/session_documents/${encodeURIComponent(normalizedDocumentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        deal_id: normalizedDealId,
        sesion_id: normalizedSessionId,
        compartir_formador: shareWithTrainer,
      }),
    },
  );

  return normalizeSessionDocument(data?.document ?? {});
}

export async function deleteSessionDocument(
  dealId: string,
  sessionId: string,
  documentId: string,
): Promise<void> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  const normalizedDocumentId = String(documentId ?? '').trim();

  if (!normalizedDealId || !normalizedSessionId || !normalizedDocumentId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId, sessionId y documentId son obligatorios');
  }

  await requestJson(`/session_documents/${encodeURIComponent(normalizedDocumentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({
      deal_id: normalizedDealId,
      sesion_id: normalizedSessionId,
    }),
  });
}

export type SessionCertificateUploadResult = {
  docId: string | null;
  fileName: string | null;
  publicUrl: string | null;
  student: { id: string | null; drive_url: string | null; certificado: boolean | null } | null;
};

export async function uploadSessionCertificate(params: {
  dealId: string;
  sessionId: string;
  studentId: string;
  fileName: string;
  file: Blob;
  mimeType?: string;
}): Promise<SessionCertificateUploadResult> {
  const normalizedDealId = String(params.dealId ?? '').trim();
  const normalizedSessionId = String(params.sessionId ?? '').trim();
  const normalizedStudentId = String(params.studentId ?? '').trim();
  const fileName = String(params.fileName ?? '').trim();

  if (!normalizedDealId || !normalizedSessionId || !normalizedStudentId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId, sessionId y studentId son obligatorios');
  }

  if (!fileName.length) {
    throw new ApiError('VALIDATION_ERROR', 'fileName es obligatorio');
  }

  const file = params.file;
  const isBlobAvailable = typeof Blob !== 'undefined' && file instanceof Blob;
  if (!isBlobAvailable) {
    throw new ApiError('VALIDATION_ERROR', 'El archivo del certificado es obligatorio');
  }
  if (file.size <= 0) {
    throw new ApiError('VALIDATION_ERROR', 'El certificado generado está vacío');
  }

  const contentBase64 = await blobToBase64(file);
  const payload = {
    dealId: normalizedDealId,
    sessionId: normalizedSessionId,
    studentId: normalizedStudentId,
    type: 'certificate',
    file: {
      fileName,
      mimeType: params.mimeType ?? (file as any).type ?? 'application/pdf',
      contentBase64,
      fileSize: file.size,
    },
  };

  const data = await requestJson<{
    doc_id?: string;
    file_name?: string;
    public_url?: string;
    student?: { id?: string; drive_url?: string; certificado?: boolean };
  }>(`/documents/upload`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const docId = toStringValue(data?.doc_id) ?? null;
  const uploadedFileName = toStringValue(data?.file_name) ?? null;
  const publicUrl = toStringValue(data?.public_url) ?? null;
  const studentData = data?.student && typeof data.student === 'object' ? data.student : null;
  const studentId = toStringValue(studentData?.id) ?? null;
  const driveUrl = toStringValue(studentData?.drive_url) ?? null;
  const certificado =
    studentData?.certificado === undefined ? null : Boolean(studentData.certificado);

  return {
    docId,
    fileName: uploadedFileName,
    publicUrl,
    student:
      studentId || driveUrl || certificado !== null
        ? { id: studentId, drive_url: driveUrl, certificado }
        : null,
  };
}
