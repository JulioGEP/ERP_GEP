import type { Handler } from '@netlify/functions';
import { COMMON_HEADERS } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';

export const handler: Handler = async () => ({
  statusCode: 200,
  headers: COMMON_HEADERS,
  body: JSON.stringify({ ok: true, ts: nowInMadridISO() }),
});
