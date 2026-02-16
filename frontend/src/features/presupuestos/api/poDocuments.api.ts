import { requestJson, toStringValue } from '../../../api/client';

export type PoDocumentRow = {
  id: string;
  nombreDocumento: string;
  empresa: string | null;
  sesion: string | null;
  fechaSesion: string | null;
  enlaceDocumento: string | null;
};

function normalizePoDocumentRow(row: unknown): PoDocumentRow | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const source = row as Record<string, unknown>;
  const id = toStringValue(source.id);
  const nombreDocumento = toStringValue(source.nombreDocumento);

  if (!id || !nombreDocumento) {
    return null;
  }

  return {
    id,
    nombreDocumento,
    empresa: toStringValue(source.empresa),
    sesion: toStringValue(source.sesion),
    fechaSesion: toStringValue(source.fechaSesion),
    enlaceDocumento: toStringValue(source.enlaceDocumento),
  };
}

export async function fetchPoDocuments(): Promise<PoDocumentRow[]> {
  const data = await requestJson<{ documents?: unknown[] }>('/po-documents');
  const rows = Array.isArray(data?.documents) ? data.documents : [];
  return rows
    .map((row) => normalizePoDocumentRow(row))
    .filter((row): row is PoDocumentRow => row !== null);
}
