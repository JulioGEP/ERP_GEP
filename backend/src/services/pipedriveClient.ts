import axios from 'axios';
import { env } from '../config/env';

function normalizePipedriveBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');

  if (!trimmed) {
    return 'https://api.pipedrive.com/v1';
  }

  if (/\/api\/v\d+$/i.test(trimmed)) {
    return trimmed;
  }

  if (/\/api$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }

  return `${trimmed}/api/v1`;
}

export const pipedriveClient = axios.create({
  baseURL: normalizePipedriveBaseUrl(env.PIPEDRIVE_BASE_URL),
  params: {
    api_token: env.PIPEDRIVE_API_TOKEN
  }
});

// --- NUEVO: helpers de acceso a la API ---
export async function getDeal(id: string) {
  const { data } = await pipedriveClient.get(`/deals/${id}`);
  return data?.data;
}

export async function getDealProducts(id: string) {
  const { data } = await pipedriveClient.get(`/deals/${id}/products`);
  return data?.data ?? [];
}

export async function getDealFiles(id: string) {
  const { data } = await pipedriveClient.get(`/deals/${id}/files`, { params: { start: 0, limit: 500 } });
  return data?.data ?? [];
}

export async function getDealNotes(id: string) {
  const { data } = await pipedriveClient.get(`/notes`, { params: { deal_id: id, limit: 500 } });
  return data?.data?.items ?? [];
}

export async function getOrganization(id: string) {
  const { data } = await pipedriveClient.get(`/organizations/${id}`);
  return data?.data;
}
