import type { Handler } from "@netlify/functions";
import { COMMON_HEADERS } from "./_shared/response";
import { nowInMadridISO } from "./_shared/timezone";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-forwarded-for",
  "x-real-ip",
]);

function sanitizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(normalizedKey)) {
      sanitized[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function decodeBody(event: Parameters<Handler>[0]): string | null {
  if (!event.body) return null;
  if (event.isBase64Encoded) {
    try {
      return Buffer.from(event.body, "base64").toString("utf8");
    } catch (error) {
      console.warn("[pipedrive-webhook-log] Failed to decode base64 body", {
        error: error instanceof Error ? error.message : String(error),
      });
      return event.body;
    }
  }
  return event.body;
}

function safeJsonParse(body: string | null): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (error) {
    console.warn("[pipedrive-webhook-log] Failed to parse body as JSON", {
      error: error instanceof Error ? error.message : String(error),
      bodyPreview: body.slice(0, 200),
    });
    return null;
  }
}

export const handler: Handler = async (event) => {
  const decodedBody = decodeBody(event);
  const parsedBody = safeJsonParse(decodedBody);

  const logEntry = {
    event: "pipedrive-webhook-log",
    timestamp: nowInMadridISO(),
    request: {
      method: event.httpMethod,
      path: event.path,
      query: event.queryStringParameters ?? {},
      headers: sanitizeHeaders(event.headers as Record<string, string | undefined>),
      isBase64Encoded: Boolean(event.isBase64Encoded),
      bodyLength: decodedBody?.length ?? 0,
      bodyPreview: decodedBody ? decodedBody.slice(0, 1000) : null,
    },
    parsedBody,
    pipedriveContext: parsedBody && typeof parsedBody === "object"
      ? {
          meta: (parsedBody as any)?.meta ?? null,
          current: (parsedBody as any)?.current ?? null,
          previous: (parsedBody as any)?.previous ?? null,
        }
      : null,
  };

  console.log(JSON.stringify(logEntry));

  return {
    statusCode: 200,
    headers: COMMON_HEADERS,
    body: JSON.stringify({
      ok: true,
      message: "Payload recibido y registrado",
      timestamp: nowInMadridISO(),
    }),
  };
};
