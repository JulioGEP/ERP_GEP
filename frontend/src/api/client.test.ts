import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, requestJson } from './client';

describe('requestJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes response metadata when the server returns invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('Internal Error. ID: 01KMBRAKZYMTY87ZKXZCC3TVF6', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-nf-request-id': 'nf-request-123',
        },
      }),
    );

    await expect(requestJson('/daily-trainers-slack?force=true')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 500,
      message: expect.stringContaining('HTTP 500 Internal Server Error'),
    } satisfies Partial<ApiError>);

    await expect(requestJson('/daily-trainers-slack?force=true')).rejects.toThrow(
      /Content-Type: text\/plain; charset=utf-8.*Request ID: nf-request-123.*Respuesta recibida: Internal Error\. ID: 01KMBRAKZYMTY87ZKXZCC3TVF6/s,
    );
  });

  it('falls back to the response body request id when no header is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('Internal Error. ID: BODY-REQUEST-ID', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: {
          'content-type': 'text/plain',
        },
      }),
    );

    await expect(requestJson('/daily-trainers-slack?force=true')).rejects.toThrow(/Request ID: BODY-REQUEST-ID/);
  });
});
