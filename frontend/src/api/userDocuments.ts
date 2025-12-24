import { DOCUMENT_TYPES, type DocumentTypeValue } from '../constants/documentTypes';
import { requestJson } from './client';

export type UserDocument = {
  id: string;
  user_id: string;
  title: string | null;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string | null;
  download_url: string;
  drive_folder_id: string | null;
  drive_web_view_link: string | null;
  drive_web_content_link: string | null;
  document_type?: DocumentTypeValue;
  document_type_label?: string | null;
};

const DEFAULT_DOCUMENT_TYPE: DocumentTypeValue = 'otros';

function resolveDocumentType(value?: DocumentTypeValue | null): DocumentTypeValue {
  if (!value) return DEFAULT_DOCUMENT_TYPE;
  return DOCUMENT_TYPES.some((option) => option.value === value) ? value : DEFAULT_DOCUMENT_TYPE;
}

export async function fetchUserDocuments(userId: string): Promise<UserDocument[]> {
  const response = await requestJson<{ documents: UserDocument[] }>(
    `/user_documents?userId=${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );
  return response.documents ?? [];
}

export async function uploadUserDocument(params: {
  userId: string;
  file: File;
  documentType?: DocumentTypeValue;
}): Promise<UserDocument> {
  const content = await fileToBase64(params.file);
  const documentType = resolveDocumentType(params.documentType);
  const response = await requestJson<{ document: UserDocument }>(
    '/user_documents',
    {
      method: 'POST',
      body: JSON.stringify({
        userId: params.userId,
        fileName: params.file.name,
        mimeType: params.file.type,
        fileData: content,
        documentType,
      }),
    },
    {
      defaultErrorMessage: 'No se pudo subir el documento.',
    },
  );
  return response.document;
}

export async function deleteUserDocument(documentId: string): Promise<void> {
  await requestJson(
    `/user_documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE' },
    { defaultErrorMessage: 'No se pudo eliminar el documento.' },
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  return btoa(binary);
}
