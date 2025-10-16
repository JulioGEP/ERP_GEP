import pdfMake from 'pdfmake/build/pdfmake';

const CERTIFICATE_ASSETS_BASE_PATH = '/certificados/';

const CERTIFICATE_FONT_FILES = {
  normal: 'Poppins-Regular.ttf',
  italics: 'Poppins-Italic.ttf',
  bold: 'Poppins-SemiBold.ttf',
  bolditalics: 'Poppins-SemiBoldItalic.ttf'
} as const;

const CERTIFICATE_IMAGE_FILES = {
  background: 'fondo-certificado.png',
  leftSidebar: 'lateral-izquierdo.png',
  footer: 'pie-firma.png',
  logo: 'logo-certificado.png'
} as const;

export type CertificateImageKey = keyof typeof CERTIFICATE_IMAGE_FILES;

const certificateImages: Partial<Record<CertificateImageKey, string>> = {};
let initializationPromise: Promise<typeof pdfMake> | undefined;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  throw new Error('No se puede convertir el buffer a base64 en este entorno.');
}

async function loadFontIntoVfs(fileName: string): Promise<void> {
  const response = await fetch(`${CERTIFICATE_ASSETS_BASE_PATH}${fileName}`);

  if (!response.ok) {
    throw new Error(`No se ha podido cargar la fuente ${fileName} (${response.status}).`);
  }

  const base64 = arrayBufferToBase64(await response.arrayBuffer());
  pdfMake.vfs = {
    ...(pdfMake.vfs || {}),
    [fileName]: base64
  };
}

async function loadImageAsset(
  fileName: string,
): Promise<{ base64: string; dataUrl: string }> {
  const response = await fetch(`${CERTIFICATE_ASSETS_BASE_PATH}${fileName}`);

  if (!response.ok) {
    throw new Error(`No se ha podido cargar la imagen ${fileName} (${response.status}).`);
  }

  const base64 = arrayBufferToBase64(await response.arrayBuffer());
  return {
    base64,
    dataUrl: `data:image/png;base64,${base64}`
  };
}

function initialisePdfMake(): Promise<typeof pdfMake> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (typeof window === 'undefined' || typeof fetch !== 'function') {
        console.warn('Inicialización de pdfMake omitida: el entorno no dispone de window o fetch.');
        return pdfMake;
      }

      const fontFiles = Object.values(CERTIFICATE_FONT_FILES);

      for (const file of fontFiles) {
        await loadFontIntoVfs(file);
      }

      pdfMake.fonts = {
        ...(pdfMake.fonts || {}),
        Poppins: {
          normal: CERTIFICATE_FONT_FILES.normal,
          italics: CERTIFICATE_FONT_FILES.italics,
          bold: CERTIFICATE_FONT_FILES.bold,
          bolditalics: CERTIFICATE_FONT_FILES.bolditalics
        }
      };

      const imagesEntries = await Promise.all(
        (Object.entries(CERTIFICATE_IMAGE_FILES) as [CertificateImageKey, string][]).map(
          async ([key, fileName]) => {
            const { base64, dataUrl } = await loadImageAsset(fileName);
            certificateImages[key] = dataUrl;
            return { key, fileName, base64, dataUrl };
          }
        )
      );

      const updatedVfs = { ...(pdfMake.vfs || {}) };
      const imageDictionary: Record<string, string> = {};

      imagesEntries.forEach(({ key, fileName, base64, dataUrl }) => {
        updatedVfs[fileName] = base64;
        imageDictionary[key] = dataUrl;
      });

      pdfMake.vfs = updatedVfs;
      pdfMake.images = {
        ...(pdfMake.images || {}),
        ...imageDictionary
      };

      const globalScope = typeof window !== 'undefined' ? window : (globalThis as Window);
      if (!('pdfMake' in globalScope)) {
        (globalScope as typeof window & { pdfMake: typeof pdfMake }).pdfMake = pdfMake;
      }

      const vfsKeys = Object.keys(pdfMake.vfs || {});

      console.info('pdfMake inicializado con fuentes e imágenes:', {
        fuentes: fontFiles,
        imagenes: Object.keys(imageDictionary),
        vfs: vfsKeys.filter((key) =>
          fontFiles.includes(key) || Object.values(CERTIFICATE_IMAGE_FILES).includes(key)
        )
      });

      return pdfMake;
    })();
  }

  return initializationPromise;
}

export const pdfMakeReady = initialisePdfMake();

export async function getPdfMakeInstance(): Promise<typeof pdfMake> {
  await pdfMakeReady;
  return pdfMake;
}

export function getCertificateImageDataUrl(key: CertificateImageKey): string | null {
  return certificateImages[key] ?? null;
}

export const CERTIFICATE_IMAGE_KEYS = Object.keys(
  CERTIFICATE_IMAGE_FILES
) as CertificateImageKey[];

export const CERTIFICATE_FONT_FILE_NAMES = Object.values(CERTIFICATE_FONT_FILES);
