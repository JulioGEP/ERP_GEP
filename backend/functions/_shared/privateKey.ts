import { gunzipSync } from "zlib";

type ServiceAccountCredentials = {
  privateKey: string;
  clientEmail?: string | null;
};

type DecodeOptions = {
  expectBase64?: boolean;
  expectGzip?: boolean;
};

function normalizeNewlines(input: string): string {
  return input.replace(/\\n/g, "\n");
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function decodeKeyValue(raw: string, options: DecodeOptions = {}): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();

  if (lower.startsWith("base64gz:")) {
    const encoded = trimmed.slice("base64gz:".length);
    return gunzipSync(decodeBase64(encoded)).toString("utf8");
  }

  if (lower.startsWith("gzbase64:")) {
    const encoded = trimmed.slice("gzbase64:".length);
    return gunzipSync(decodeBase64(encoded)).toString("utf8");
  }

  if (lower.startsWith("base64:")) {
    const encoded = trimmed.slice("base64:".length);
    return decodeBase64(encoded).toString("utf8");
  }

  if (lower.startsWith("gzip:")) {
    const encoded = trimmed.slice("gzip:".length);
    return gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  }

  if (lower.startsWith("gz:")) {
    const encoded = trimmed.slice("gz:".length);
    return gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  }

  if (options.expectBase64 || options.expectGzip) {
    try {
      const buffer = decodeBase64(trimmed);
      return options.expectGzip ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
    } catch (error) {
      throw new Error("SERVICE_ACCOUNT_PRIVATE_KEY_INVALID_ENCODING");
    }
  }

  return normalizeNewlines(trimmed);
}

function decodeFromObject(value: Record<string, unknown>): ServiceAccountCredentials {
  let privateKey: string | null = null;
  let clientEmail: string | null = null;

  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const normalizedKey = key.toLowerCase();

    if (normalizedKey.includes("client") && normalizedKey.includes("email")) {
      if (!clientEmail) {
        clientEmail = rawValue.trim();
      }
      continue;
    }

    if (normalizedKey.includes("private") && normalizedKey.includes("key")) {
      if (privateKey) {
        continue;
      }

      const expectBase64 = normalizedKey.includes("base64") || normalizedKey.includes("b64");
      const expectGzip = normalizedKey.includes("gzip") || normalizedKey.includes("gz");
      privateKey = decodeKeyValue(rawValue, { expectBase64, expectGzip }).trim();
    }
  }

  if (!privateKey) {
    return { privateKey: "", clientEmail };
  }

  return { privateKey: normalizeNewlines(privateKey), clientEmail };
}

export function decodeServiceAccountCredentials(raw: string): ServiceAccountCredentials {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { privateKey: "" };
  }

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error("SERVICE_ACCOUNT_PRIVATE_KEY_INVALID_JSON");
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return decodeFromObject(parsed as Record<string, unknown>);
    }

    throw new Error("SERVICE_ACCOUNT_PRIVATE_KEY_UNSUPPORTED_JSON");
  }

  return { privateKey: normalizeNewlines(decodeKeyValue(trimmed).trim()) };
}
