import { getJson } from '../../api/client';

export type PipedriveWebhookEntry = {
  id: string;
  request_uuid: string;
  received_at: string | null;
  updated_at: string | null;
  payload: unknown;
};

export type PipedriveWebhooksResponse = {
  ok: boolean;
  webhooks?: PipedriveWebhookEntry[];
  message?: string;
  error_code?: string;
};

export const PIPEDRIVE_WEBHOOKS_QUERY_KEY = ['pipedrive-webhooks'];

export async function fetchPipedriveWebhooks(): Promise<PipedriveWebhookEntry[]> {
  const response = await getJson<PipedriveWebhooksResponse>('/api/pipedrive-webhooks');
  const records = Array.isArray(response.webhooks) ? response.webhooks : [];

  return records.map((record) => ({
    id: String(record.id ?? ''),
    request_uuid: String(record.request_uuid ?? ''),
    received_at: record.received_at ?? null,
    updated_at: record.updated_at ?? null,
    payload: record.payload,
  }));
}
