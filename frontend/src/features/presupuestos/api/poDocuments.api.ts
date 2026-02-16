import { requestJson, toStringValue } from '../../../api/client';

export type PoDocument = {
  id: string;
  name: string;
  kind: 'presupuesto' | 'sesion';
  dealId: string | null;
  sessionId: string | null;
  sessionName: string | null;
  sessionDate: string | null;
  companyName: string | null;
  createdAt: string | null;
  url: string | null;
};

function normalizePoDocument(value: any): PoDocument {
  const kind = value?.kind === 'sesion' ? 'sesion' : 'presupuesto';
  return {
    id: toStringValue(value?.id) ?? '',
    name: toStringValue(value?.name) ?? 'Sin nombre',
    kind,
    dealId: toStringValue(value?.deal_id ?? value?.dealId),
    sessionId: toStringValue(value?.session_id ?? value?.sessionId),
    sessionName: toStringValue(value?.session_name ?? value?.sessionName),
    sessionDate: toStringValue(value?.session_date ?? value?.sessionDate),
    companyName: toStringValue(value?.company_name ?? value?.companyName),
    createdAt: toStringValue(value?.created_at ?? value?.createdAt),
    url: toStringValue(value?.url),
  };
}

export async function fetchPoDocuments(): Promise<PoDocument[]> {
  const data = await requestJson<{ documents?: unknown[] }>('/po_documents');
  const rows = Array.isArray(data?.documents) ? data.documents : [];
  return rows.map((row) => normalizePoDocument(row));
}
