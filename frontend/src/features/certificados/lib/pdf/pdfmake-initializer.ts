import pdfMake from 'pdfmake/build/pdfmake';
import { arrayBufferToBase64 } from '../../../../utils/base64';

const CERTIFICATE_ASSETS_BASE_PATH = '/certificados/';

const CERTIFICATE_FONT_FILES = {
  normal: 'Poppins-Regular.ttf',
  italics: 'Poppins-Italic.ttf',
  bold: 'Poppins-SemiBold.ttf',
  bolditalics: 'Poppins-SemiBoldItalic.ttf',
} as const;

let initializationPromise: Promise<typeof pdfMake> | undefined;

async function loadFontIntoVfs(fileName: string): Promise<void> {
  const response = await fetch(`${CERTIFICATE_ASSETS_BASE_PATH}${fileName}`);
  if (!response.ok) {
    throw new Error(`No se ha podido cargar la fuente ${fileName} (${response.status}).`);
  }

  const base64 = arrayBufferToBase64(await response.arrayBuffer());
  pdfMake.vfs = {
    ...(pdfMake.vfs || {}),
    [fileName]: base64,
  };
}

// Este tipo evita castear a Window (que requiere props como "name").
// Solo añadimos la propiedad opcional pdfMake al global actual.
type GlobalWithPdfMake = typeof globalThis & { pdfMake?: typeof pdfMake };

// ---- initializer -----------------------------------------------------------

function initialisePdfMake(): Promise<typeof pdfMake> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (typeof window === 'undefined' || typeof fetch !== 'function') {
        console.warn('Inicialización de pdfMake omitida: el entorno no dispone de window o fetch.');
        return pdfMake;
      }

      // Ensanchamos a string[] para que .includes() acepte "string"
      const fontFiles: string[] = Object.values(CERTIFICATE_FONT_FILES) as string[];

      // Carga de las fuentes en VFS
      for (const file of fontFiles) {
        await loadFontIntoVfs(file);
      }

      // Registro de familias
      pdfMake.fonts = {
        ...(pdfMake.fonts || {}),
        Poppins: {
          normal: CERTIFICATE_FONT_FILES.normal,
          italics: CERTIFICATE_FONT_FILES.italics,
          bold: CERTIFICATE_FONT_FILES.bold,
          bolditalics: CERTIFICATE_FONT_FILES.bolditalics,
        },
      };

      // Uso de window si existe, si no globalThis; sin castear a Window
      const globalScope: GlobalWithPdfMake =
        (typeof window !== 'undefined' ? window : globalThis) as GlobalWithPdfMake;

      if (!('pdfMake' in globalScope)) {
        (globalScope as GlobalWithPdfMake).pdfMake = pdfMake;
      }

      const vfsKeys = Object.keys(pdfMake.vfs || {});
      console.info('pdfMake inicializado con fuentes:', {
        fuentes: fontFiles,
        vfs: vfsKeys.filter((key) => fontFiles.includes(key)),
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

export const CERTIFICATE_FONT_FILE_NAMES = Object.values(CERTIFICATE_FONT_FILES) as string[];
