import { ApiError, requestJson, toNonNegativeInteger, toStringValue } from '../../api/client';
import { blobOrFileToBase64 } from '../../utils/base64';

export type BulkSessionImportRow = {
  row: number;
  deal_id: string | null;
  deal_product_id: string | null;
  session_id?: string | null;
  status: 'created' | 'error';
  message?: string | null;
};

export type BulkSessionImportResponse = {
  summary: { total: number; created: number; failed: number };
  results: BulkSessionImportRow[];
};

function normalizeSummary(raw: any): BulkSessionImportResponse['summary'] {
  const total = toNonNegativeInteger(raw?.total);
  const created = toNonNegativeInteger(raw?.created);
  const failed = toNonNegativeInteger(raw?.failed);

  return {
    total: total ?? 0,
    created: created ?? 0,
    failed: failed ?? 0,
  };
}

function normalizeResultRow(row: any, index: number): BulkSessionImportRow {
  const dealId = toStringValue(row?.deal_id) ?? null;
  const dealProductId = toStringValue(row?.deal_product_id) ?? null;
  const sessionId = row?.session_id ? String(row.session_id) : null;
  const status: 'created' | 'error' = row?.status === 'created' ? 'created' : 'error';
  const message = typeof row?.message === 'string' ? row.message : null;

  const normalizedRow = toNonNegativeInteger(row?.row);

  return {
    row: normalizedRow ?? index + 1,
    deal_id: dealId,
    deal_product_id: dealProductId,
    session_id: sessionId,
    status,
    message,
  };
}

export async function importSessionsFromExcel(file: File): Promise<BulkSessionImportResponse> {
  if (!file) {
    throw new ApiError('VALIDATION_ERROR', 'Debes seleccionar un fichero Excel');
  }

  const fileData = await blobOrFileToBase64(file);
  const payload = { fileName: file.name, fileData };

  const data = await requestJson<{ summary?: unknown; results?: unknown[] }>('/sessions/import-bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const rawRows: unknown[] = Array.isArray(data?.results) ? data?.results ?? [] : [];

  return {
    summary: normalizeSummary(data?.summary ?? {}),
    results: rawRows.map((row, index) => normalizeResultRow(row, index)),
  };
}
