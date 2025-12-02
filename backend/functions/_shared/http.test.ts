import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { createHttpHandler } from './http';
import { successResponse } from './response';

describe('createHttpHandler', () => {
  it('returns preflight response for OPTIONS requests', async () => {
    const handler = createHttpHandler(async () => {
      throw new Error('should not be invoked for OPTIONS');
    });

    const response = await handler(
      {
        httpMethod: 'OPTIONS',
        headers: {},
        path: '/',
      } as any,
      {} as any,
    );

    assert.equal(response.statusCode, 204);
    assert.equal(response.body, '');
  });

  it('parses JSON body and forwards it to the handler', async () => {
    let receivedBody: unknown = null;
    let receivedRawBody: string | null = null;
    const handler = createHttpHandler(async (request) => {
      receivedBody = request.body;
      receivedRawBody = request.rawBody;
      return successResponse({ ok: true });
    });

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/test',
        headers: {
          'content-type': 'application/json',
          'x-erp-client': 'frontend',
        },
        body: '{"hello":"world"}',
      } as any,
      {} as any,
    );

    assert.deepEqual(receivedBody, { hello: 'world' });
    assert.equal(receivedRawBody, '{"hello":"world"}');
    assert.equal(response.statusCode, 200);
  });

  it('decodes base64 encoded payloads before parsing JSON', async () => {
    let receivedRawBody: string | null = null;
    const handler = createHttpHandler(async (request) => {
      receivedRawBody = request.rawBody;
      return successResponse({ ok: true });
    });

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/base64',
        headers: { 'x-erp-client': 'frontend' },
        body: Buffer.from('{"foo":123}', 'utf8').toString('base64'),
        isBase64Encoded: true,
      } as any,
      {} as any,
    );

    assert.equal(receivedRawBody, '{"foo":123}');
    assert.equal(response.statusCode, 200);
  });

  it('returns a 400 error when the JSON body is invalid', async () => {
    const handler = createHttpHandler(async () => successResponse({ ok: true }));

    const response = await handler(
      {
        httpMethod: 'POST',
        path: '/invalid',
        headers: { 'x-erp-client': 'frontend' },
        body: '{"foo"',
      } as any,
      {} as any,
    );

    assert.equal(response.statusCode, 400);
    const responseBody =
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {});
    const parsed = JSON.parse(responseBody || '{}');
    assert.equal(parsed.error_code, 'INVALID_JSON');
    assert.equal(parsed.ok, false);
  });

  it('normalizes unexpected errors into a 500 response', async () => {
    const handler = createHttpHandler(async () => {
      throw new Error('boom');
    });

    const response = await handler(
      {
        httpMethod: 'GET',
        path: '/error',
        headers: { 'x-erp-client': 'frontend' },
      } as any,
      {} as any,
    );

    assert.equal(response.statusCode, 500);
    const responseBody =
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {});
    const parsed = JSON.parse(responseBody || '{}');
    assert.equal(parsed.error_code, 'UNEXPECTED_ERROR');
    assert.equal(parsed.ok, false);
  });
});

describe('createHttpHandler – trusted client validation', () => {
  it('rejects requests without trusted header or origin', async () => {
    const handler = createHttpHandler(async () => successResponse({ ok: true }));

    const response = await handler(
      {
        httpMethod: 'GET',
        path: '/untrusted',
      } as any,
      {} as any,
    );

    assert.equal(response.statusCode, 403);
  });

  it('allows requests that include the trusted client header', async () => {
    const handler = createHttpHandler(async () => successResponse({ ok: true }));

    const response = await handler(
      {
        httpMethod: 'GET',
        path: '/trusted',
        headers: { 'x-erp-client': 'frontend' },
      } as any,
      {} as any,
    );

    assert.equal(response.statusCode, 200);
  });
});
