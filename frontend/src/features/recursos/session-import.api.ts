import { postJson } from '../../api/client';

export type SessionImportRowInput = {
  dealId: string;
  sessionNumber: string;
  start: string;
  end: string;
  trainer: string;
  trainerSup: string;
  estado: string;
};

export type SessionImportRequest = {
  dealId: string;
  rows: SessionImportRowInput[];
};

export type SessionImportResponse = {
  dealId: string;
  created: number;
  updated: number;
  removed: number;
  message?: string;
};

export async function importSessionBatch(payload: SessionImportRequest): Promise<SessionImportResponse> {
  return postJson('/session-imports', payload);
}
