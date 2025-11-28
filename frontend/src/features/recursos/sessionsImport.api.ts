import { ApiError, requestJson } from '../../api/client';

export type SessionImportResult = {
  imported: number;
  failed: number;
  results: Array<{ row: number; sessionId?: string; error?: string }>;
};

export async function importSessionsFromExcel(fileBase64: string): Promise<SessionImportResult> {
  const normalized = typeof fileBase64 === 'string' ? fileBase64.trim() : '';
  if (!normalized) {
    throw new ApiError('VALIDATION_ERROR', 'Debes seleccionar un archivo Excel para importar.');
  }

  const data = await requestJson<{
    imported?: unknown;
    failed?: unknown;
    results?: unknown;
  }>('/resources-import-sessions', {
    method: 'POST',
    body: JSON.stringify({ fileBase64: normalized }),
  });

  const imported = Number(data?.imported ?? 0);
  const failed = Number(data?.failed ?? 0);
  const results = Array.isArray(data?.results)
    ? (data!.results as Array<{ row: number; sessionId?: string; error?: string }>)
    : [];

  return { imported, failed, results };
}
