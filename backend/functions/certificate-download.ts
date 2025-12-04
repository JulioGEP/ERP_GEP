// backend/functions/certificate-download.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { COMMON_HEADERS, errorResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  const rawUrl = request.query.url ?? '';
  if (!rawUrl) {
    return errorResponse('VALIDATION_ERROR', 'Falta la URL de descarga', 400);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch (error) {
    console.error('[certificate-download] Invalid URL', error);
    return errorResponse('VALIDATION_ERROR', 'URL de descarga inválida', 400);
  }

  if (!ALLOWED_PROTOCOLS.has(targetUrl.protocol)) {
    return errorResponse('VALIDATION_ERROR', 'Protocolo no permitido', 400);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, { redirect: 'follow' });
  } catch (error) {
    console.error('[certificate-download] Fetch failed', error);
    return errorResponse('DOWNLOAD_ERROR', 'No se pudo descargar el certificado', 502);
  }

  if (!upstreamResponse.ok) {
    console.error('[certificate-download] Upstream responded with error', {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      url: targetUrl.toString(),
    });
    return errorResponse('DOWNLOAD_ERROR', 'No se pudo descargar el certificado', 502);
  }

  const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
  const contentType = upstreamResponse.headers.get('content-type') ?? 'application/octet-stream';

  const headers = { ...COMMON_HEADERS, 'Content-Type': contentType } as Record<string, string>;
  delete headers['Content-Disposition'];

  return {
    statusCode: 200,
    headers,
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
});

export default handler;
