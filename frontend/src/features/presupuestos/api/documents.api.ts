import { ApiError, requestJson, toStringValue } from '../../../api/client';
import { blobOrFileToBase64 } from '../../../utils/base64';
import { normalizeSessionDocument } from './normalizers';
import type { SessionDocument, SessionDocumentsPayload } from '../../../api/sessions.types';

async function request<T = any>(path: string, init?: RequestInit) {
  return requestJson<T>(path, init);
}

export const SESSION_DOCUMENT_SIZE_LIMIT_BYTES = 4 * 1024 * 1024;
export const SESSION_DOCUMENT_SIZE_LIMIT_LABEL = '4 MB';
export const SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE = `Archivo demasiado pesado, máximo ${SESSION_DOCUMENT_SIZE_LIMIT_LABEL}`;

export async function fetchSessionDocuments(
  dealId: string,
  sessionId: string,
): Promise<SessionDocumentsPayload> {
  const normalizedDealId = String(dealId ?? '').trim();
  const normalizedSessionId = String(sessionId ?? '').trim();
  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }

  const params = new URLSearchParams({ dealId: normalizedDealId, sessionId: normalizedSessionId });
  const data = await request<{ documents?: unknown[]; drive_url?: unknown; driveUrl?: unknown }>(
    `/session_documents?${params.toString()}`,
  );
  const docs: unknown[] = Array.isArray(data?.documents) ? data.documents : [];
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
  trainerExpense?: boolean;
  trainerName?: string | null;
  expenseFolderName?: string | null;
  user?: { id?: string | null; name?: string | null };
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

  const trainerExpense = Boolean(params.trainerExpense);
  const trainerName = typeof params.trainerName === 'string' ? params.trainerName.trim() : '';
  const expenseFolderName =
    typeof params.expenseFolderName === 'string' ? params.expenseFolderName.trim() : '';

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
      contentBase64: await blobOrFileToBase64(file),
    })),
  );

  const headers: Record<string, string> = {};
  const userId = typeof params.user?.id === 'string' ? params.user.id.trim() : '';
  const userName = typeof params.user?.name === 'string' ? params.user.name.trim() : '';
  if (userId.length) headers['X-User-Id'] = userId;
  if (userName.length) headers['X-User-Name'] = userName;

  const data = await request<{ documents?: unknown[]; drive_url?: unknown; driveUrl?: unknown }>(
    `/session_documents`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deal_id: normalizedDealId,
        sesion_id: normalizedSessionId,
        compartir_formador: params.shareWithTrainer,
        trainer_expense: trainerExpense || undefined,
        expense_folder_name: trainerExpense
          ? expenseFolderName || 'Gastos Formador'
          : undefined,
        trainer_name: trainerExpense && trainerName ? trainerName : undefined,
        files: payloadFiles,
      }),
    },
  );

  const docs: unknown[] = Array.isArray(data?.documents) ? data.documents : [];
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

  const data = await request<{ document?: unknown }>(
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

  await request(`/session_documents/${encodeURIComponent(normalizedDocumentId)}`, {
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

  const contentBase64 = await blobOrFileToBase64(file);
  const payload = {
    dealId: normalizedDealId,
    sessionId: normalizedSessionId,
    studentId: normalizedStudentId,
    type: 'certificate',
    file: {
      fileName,
      mimeType: params.mimeType ?? file.type ?? 'application/pdf',
      contentBase64,
      fileSize: file.size,
    },
  };

  const data = await request<{ doc_id?: unknown; file_name?: unknown; public_url?: unknown; student?: unknown }>(
    '/documents/upload',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  const docId = toStringValue(data?.doc_id) ?? null;
  const uploadedFileName = toStringValue(data?.file_name) ?? null;
  const publicUrl = toStringValue(data?.public_url) ?? null;
  const studentData = data?.student && typeof data.student === 'object' ? (data.student as any) : null;
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
