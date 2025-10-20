const PDF_LIB_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

export interface PdfLibEmbeddedPage {
  readonly width: number;
  readonly height: number;
}

export interface PdfLibPage {
  getSize(): { width: number; height: number };
  drawPage(page: PdfLibEmbeddedPage, options: { x: number; y: number; width: number; height: number }): void;
}

export interface PdfLibDocument {
  embedPdf(bytes: Uint8Array | ArrayBuffer | ArrayBufferLike): Promise<PdfLibEmbeddedPage[]>;
  getPages(): PdfLibPage[];
  save(): Promise<Uint8Array>;
}

export interface PdfLibModule {
  PDFDocument: {
    load(data: Uint8Array | ArrayBuffer | ArrayBufferLike | string): Promise<PdfLibDocument>;
  };
}

declare global {
  interface Window {
    PDFLib?: unknown;
  }
}

let pdfLibPromise: Promise<PdfLibModule> | null = null;

function resolvePdfLibFromWindow(): PdfLibModule | null {
  const pdfLib = typeof window !== 'undefined' ? (window.PDFLib as PdfLibModule | undefined) : undefined;
  return pdfLib ?? null;
}

function loadPdfLibScript(): Promise<PdfLibModule> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('La librería pdf-lib solo se puede cargar en un entorno de navegador.'));
  }

  return new Promise((resolve, reject) => {
    const existingInstance = resolvePdfLibFromWindow();
    if (existingInstance) {
      resolve(existingInstance);
      return;
    }

    const script = document.createElement('script');
    script.src = PDF_LIB_CDN_URL;
    script.async = true;

    script.onload = () => {
      const loadedInstance = resolvePdfLibFromWindow();
      if (loadedInstance) {
        resolve(loadedInstance);
        return;
      }

      pdfLibPromise = null;
      reject(new Error('No se pudo inicializar pdf-lib después de cargar el script.'));
    };

    script.onerror = () => {
      pdfLibPromise = null;
      reject(new Error('No se pudo cargar el script remoto de pdf-lib.'));
    };

    document.head.append(script);
  });
}

export async function loadPdfLib(): Promise<PdfLibModule> {
  if (pdfLibPromise) {
    return pdfLibPromise;
  }

  const cachedInstance = resolvePdfLibFromWindow();
  if (cachedInstance) {
    pdfLibPromise = Promise.resolve(cachedInstance);
    return pdfLibPromise;
  }

  pdfLibPromise = loadPdfLibScript();
  return pdfLibPromise;
}
