import { requestJson } from './client';

export type UserDocument = {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string | null;
  download_url: string;
};

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
}): Promise<UserDocument> {
  const content = await fileToBase64(params.file);
  const response = await requestJson<{ document: UserDocument }>(
    '/user_documents',
    {
      method: 'POST',
      body: JSON.stringify({
        userId: params.userId,
        fileName: params.file.name,
        mimeType: params.file.type,
        fileData: content,
      }),
    },
    {
      defaultErrorMessage: 'No se pudo subir el documento.',
    },
  );
  return response.document;
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
