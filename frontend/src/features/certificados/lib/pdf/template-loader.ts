const CERTIFICATE_TEMPLATE_PATH = '/certificados/certificado_final.pdf';

let templateBytesPromise: Promise<Uint8Array> | null = null;
let cachedTemplateBytes: Uint8Array | null = null;

async function fetchTemplateBytes(): Promise<Uint8Array> {
  if (typeof fetch !== 'function') {
    throw new Error('El entorno actual no permite cargar el certificado base.');
  }

  const response = await fetch(CERTIFICATE_TEMPLATE_PATH);
  if (!response.ok) {
    throw new Error(
      `No se ha podido cargar la plantilla de certificado (${response.status}).`,
    );
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function ensureTemplateBytes(): Promise<Uint8Array> {
  if (cachedTemplateBytes) {
    return cachedTemplateBytes;
  }

  if (!templateBytesPromise) {
    templateBytesPromise = fetchTemplateBytes().then((bytes) => {
      cachedTemplateBytes = bytes;
      return bytes;
    });
  }

  return templateBytesPromise;
}

export async function loadCertificateTemplateBytes(): Promise<Uint8Array> {
  const bytes = await ensureTemplateBytes();
  return bytes.slice();
}

export const certificateTemplateReady = ensureTemplateBytes()
  .then(() => undefined)
  .catch((error) => {
    console.error('No se pudo preparar la plantilla de certificados.', error);
    throw error;
  });
