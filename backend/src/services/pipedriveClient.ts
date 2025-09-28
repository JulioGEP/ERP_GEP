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
