// frontend/src/features/recursos/sessions-import.api.ts
import { postJson } from '../../api/client';

export type SessionImportRow = {
  deal_id: string;
  deal_product_id: string;
  fecha_inicio_utc?: string | Date | null;
  fecha_fin_utc?: string | Date | null;
  trainer_id?: string | null;
  estado?: string | null;
};

export type SessionImportResult = {
  index: number;
  deal_id: string | null;
  deal_product_id: string | null;
  session_id?: string;
  status: 'success' | 'error';
  message: string;
};

export type SessionImportResponse = {
  results: SessionImportResult[];
  summary: { total: number; successes: number; errors: number };
};

export async function importSessions(rows: SessionImportRow[]): Promise<SessionImportResponse> {
  return postJson<SessionImportResponse>('/sessions-import', { rows });
}

