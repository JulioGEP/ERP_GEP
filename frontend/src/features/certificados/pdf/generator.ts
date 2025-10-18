import { PDFDocument } from 'pdf-lib';
import type { Content, StyleDictionary, TDocumentDefinitions } from 'pdfmake/interfaces';
import { getPdfMakeInstance } from '../lib/pdf/pdfmake-initializer';
import { loadCertificateTemplateBytes } from '../lib/pdf/template-loader';

export interface CertificateStudentData {
  nombre: string;
  apellido: string;
  dni: string;
}

export interface CertificateSessionData {
  fecha_inicio_utc: string;
}

export interface CertificateDealData {
  sede_labels: string | string[];
}

export interface CertificateProductData {
  hours: number;
  name: string;
}

export interface CertificateGenerationData {
  alumno: CertificateStudentData;
  sesion: CertificateSessionData;
  deal: CertificateDealData;
  producto: CertificateProductData;
  theoreticalItems?: string[];
  practicalItems?: string[];
}

export type CertificateTextLayoutAdjustments = {
  textBlock?: {
    offsetX?: number;
    offsetY?: number;
    widthDelta?: number;
  };
};

export type CertificateTemplatePreviewOptions = {
  courseName?: string;
  theoreticalItems?: string[];
  practicalItems?: string[];
  hours?: number;
  layoutAdjustments?: CertificateTextLayoutAdjustments;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const DEFAULT_TEXT_START_Y = 48;
const TEXT_RIGHT_MARGIN = 40;
const LEFT_OFFSET_RATIO = 0.35;
const RIGHT_BLEED = 30;
const LEFT_EXTRA_OFFSET_RATIO = 1.1;
const LOGO_TARGET_WIDTH = 180;
const BACKGROUND_LEFT_SHIFT = 10;
const LEFT_SIDEBAR_SIZE_REDUCTION = 0.9;
const LEFT_SIDEBAR_RIGHT_SHIFT = 5;
const FOOTER_SIZE_REDUCTION = 0.9;
const PRACTICAL_COLUMN_LEFT_SHIFT = 40;
const TABLE_CELL_PADDING = {
  left: 0,
  right: 6,
  top: 6,
  bottom: 6,
} as const;

const MIN_TEXT_BLOCK_WIDTH = 260;

const IMAGE_DIMENSIONS = {
  background: { width: 839, height: 1328 },
  leftSidebar: { width: 85, height: 1241 },
  footer: { width: 853, height: 153 },
  logo: { width: 827, height: 382 },
} as const;

const BACKGROUND_WIDTH_SCALE = 0.5;
const LEFT_SIDEBAR_HEIGHT_SCALE = 1.4;
const LEFT_SIDEBAR_HORIZONTAL_SHIFT = 10;

const DEFAULT_LEFT_SIDEBAR_RIGHT_EDGE = (() => {
  const leftSidebarHeight = PAGE_HEIGHT * LEFT_SIDEBAR_HEIGHT_SCALE * LEFT_SIDEBAR_SIZE_REDUCTION;
  const leftSidebarScale = leftSidebarHeight / IMAGE_DIMENSIONS.leftSidebar.height;
  const leftSidebarWidth = IMAGE_DIMENSIONS.leftSidebar.width * leftSidebarScale;
  const leftSidebarX =
    -leftSidebarWidth * LEFT_OFFSET_RATIO * LEFT_EXTRA_OFFSET_RATIO -
    LEFT_SIDEBAR_HORIZONTAL_SHIFT +
    LEFT_SIDEBAR_RIGHT_SHIFT;
  return leftSidebarX + leftSidebarWidth;
})();

const PREVIEW_SAMPLE_DATA: CertificateGenerationData = {
  alumno: {
    nombre: 'Nombre',
    apellido: 'Apellido',
    dni: '12345678A',
  },
  sesion: {
    fecha_inicio_utc: '2025-10-16',
  },
  deal: {
    sede_labels: 'Valencia',
  },
  producto: {
    name: 'Formación genérica de ejemplo',
    hours: 8,
  },
  theoreticalItems: [
    'Teoría del fuego.',
    'Clases de fuego y agentes extintores.',
    'Plan de autoprotección.',
    'Procedimientos de emergencia.',
  ],
  practicalItems: [
    'Uso práctico de extintores.',
    'Simulacro de evacuación.',
    'Aplicación de primeros auxilios.',
  ],
};

type NormalizedAxisPlacement = {
  /**
   * Percentage-based position for the leading edge of an element.
   *
   * For horizontal values: 0 = left edge, 100 = right edge.
   * For vertical values: 0 = bottom edge, 100 = top edge.
   */
  percent: number;
};

type CertificateElementPlacement = {
  horizontal?: NormalizedAxisPlacement;
  vertical?: NormalizedAxisPlacement;
};

type CertificateLayoutConfig = {
  background: CertificateElementPlacement;
  leftSidebar: CertificateElementPlacement;
  footer: CertificateElementPlacement;
  logo: CertificateElementPlacement;
  textContent: CertificateElementPlacement;
};

function createDefaultCertificateLayout(): CertificateLayoutConfig {
  const backgroundHeight = PAGE_HEIGHT;
  const backgroundBaseWidth =
    (IMAGE_DIMENSIONS.background.width / IMAGE_DIMENSIONS.background.height) * backgroundHeight;
  const backgroundWidth = backgroundBaseWidth * BACKGROUND_WIDTH_SCALE;
  const backgroundX = PAGE_WIDTH - backgroundWidth + RIGHT_BLEED - BACKGROUND_LEFT_SHIFT;
  const backgroundAvailableX = PAGE_WIDTH - backgroundWidth;

  const leftSidebarHeight =
    PAGE_HEIGHT * LEFT_SIDEBAR_HEIGHT_SCALE * LEFT_SIDEBAR_SIZE_REDUCTION;
  const leftSidebarScale = leftSidebarHeight / IMAGE_DIMENSIONS.leftSidebar.height;
  const leftSidebarWidth = IMAGE_DIMENSIONS.leftSidebar.width * leftSidebarScale;
  const leftSidebarX =
    -leftSidebarWidth * LEFT_OFFSET_RATIO * LEFT_EXTRA_OFFSET_RATIO -
    LEFT_SIDEBAR_HORIZONTAL_SHIFT +
    LEFT_SIDEBAR_RIGHT_SHIFT;
  const leftSidebarY = -(leftSidebarHeight - PAGE_HEIGHT) / 2;
  const leftSidebarAvailableX = PAGE_WIDTH - leftSidebarWidth;
  const leftSidebarAvailableY = PAGE_HEIGHT - leftSidebarHeight;

  const lateralRightEdge = leftSidebarX + leftSidebarWidth;
  const textStartX = Math.max(lateralRightEdge + 10, 60);
  const textWidth = Math.max(
    MIN_TEXT_BLOCK_WIDTH,
    PAGE_WIDTH - textStartX - TEXT_RIGHT_MARGIN,
  );
  const textAvailableX = PAGE_WIDTH - textWidth;
  const textStartPercent = textAvailableX === 0 ? 0 : (textStartX / textAvailableX) * 100;

  const footerScale =
    (PAGE_WIDTH / IMAGE_DIMENSIONS.footer.width) * 0.8 * FOOTER_SIZE_REDUCTION;
  const footerHeight = IMAGE_DIMENSIONS.footer.height * footerScale;
  const footerAvailableY = PAGE_HEIGHT - footerHeight;
  const footerBottomOffset = 8;
  const footerTopPercent =
    footerAvailableY === 0 ? 0 : (footerBottomOffset / footerAvailableY) * 100;

  const logoScale = LOGO_TARGET_WIDTH / IMAGE_DIMENSIONS.logo.width;
  const logoWidth = LOGO_TARGET_WIDTH;
  const logoHeight = IMAGE_DIMENSIONS.logo.height * logoScale;
  const logoX = PAGE_WIDTH - logoWidth - 10;
  const logoY = (PAGE_HEIGHT - logoHeight) / 2;
  const logoAvailableX = PAGE_WIDTH - logoWidth;
  const logoAvailableY = PAGE_HEIGHT - logoHeight;

  return {
    background: {
      horizontal: {
        percent: backgroundAvailableX === 0 ? 0 : (backgroundX / backgroundAvailableX) * 100,
      },
      vertical: { percent: 100 },
    },
    leftSidebar: {
      horizontal: {
        percent: leftSidebarAvailableX === 0 ? 0 : (leftSidebarX / leftSidebarAvailableX) * 100,
      },
      vertical: {
        percent:
          leftSidebarAvailableY === 0
            ? 0
            : 100 - (leftSidebarY / leftSidebarAvailableY) * 100,
      },
    },
    footer: {
      horizontal: { percent: 50 },
      vertical: { percent: footerTopPercent },
    },
    logo: {
      horizontal: {
        percent: logoAvailableX === 0 ? 0 : (logoX / logoAvailableX) * 100,
      },
      vertical: {
        percent: logoAvailableY === 0 ? 0 : 100 - (logoY / logoAvailableY) * 100,
      },
    },
    textContent: {
      horizontal: { percent: textStartPercent },
      vertical: {
        percent: 100 - (DEFAULT_TEXT_START_Y / PAGE_HEIGHT) * 100,
      },
    },
  };
}

/**
 * Placement presets expressed in normalized percentages so the PDF layout can be
 * tweaked with simple "move to X/Y" style instructions.
 */
const CERTIFICATE_ELEMENT_LAYOUT = createDefaultCertificateLayout();

function resolveHorizontalPosition(
  placement: NormalizedAxisPlacement | undefined,
  elementWidth: number,
): number {
  if (!placement) {
    return 0;
  }

  const available = PAGE_WIDTH - elementWidth;
  if (Math.abs(available) < 0.0001) {
    return 0;
  }

  return (placement.percent / 100) * available;
}

function resolveVerticalPosition(
  placement: NormalizedAxisPlacement | undefined,
  elementHeight: number,
): number {
  if (!placement) {
    return 0;
  }

  const available = PAGE_HEIGHT - elementHeight;
  if (Math.abs(available) < 0.0001) {
    return 0;
  }

  return ((100 - placement.percent) / 100) * available;
}

function resolveTextHorizontalPlacement(
  placement: NormalizedAxisPlacement | undefined,
  lateralRightEdge: number,
): { x: number; width: number } {
  const percent = placement?.percent ?? 0;
  let width = Math.max(
    MIN_TEXT_BLOCK_WIDTH,
    PAGE_WIDTH - (lateralRightEdge + 10) - TEXT_RIGHT_MARGIN,
  );
  let x = lateralRightEdge + 10;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const available = PAGE_WIDTH - width;
    const base = Math.abs(available) < 0.0001 ? 0 : (percent / 100) * available;
    const candidateX = Math.max(lateralRightEdge + 10, base);
    const nextWidth = Math.max(MIN_TEXT_BLOCK_WIDTH, PAGE_WIDTH - candidateX - TEXT_RIGHT_MARGIN);

    if (Math.abs(nextWidth - width) < 0.01 && Math.abs(candidateX - x) < 0.01) {
      x = candidateX;
      width = nextWidth;
      break;
    }

    x = candidateX;
    width = nextWidth;
  }

  width = Math.max(MIN_TEXT_BLOCK_WIDTH, PAGE_WIDTH - x - TEXT_RIGHT_MARGIN);

  return { x, width };
}

function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureList(items?: string[]): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => normaliseText(item))
    .filter((item): item is string => item.length > 0);
}

function formatDate(value: string): string {
  const trimmed = normaliseText(value);
  if (!trimmed) {
    return '';
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}-${month}-${year}`;
  }

  const dayFirstMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dayFirstMatch) {
    const [, day, month, year] = dayFirstMatch;
    return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year.padStart(4, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = String(parsed.getFullYear()).padStart(4, '0');
    return `${day}-${month}-${year}`;
  }

  return trimmed.replace(/[\/]/g, '-');
}

function formatHours(value: number): string {
  if (Number.isFinite(value)) {
    return value.toLocaleString('es-ES', { maximumFractionDigits: 2, useGrouping: false });
  }
  return String(value);
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || base64.length === 0) {
    return new Uint8Array();
  }

  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  throw new Error('No se puede decodificar datos base64 en este entorno.');
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    return '';
  }

  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
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

  throw new Error('No se puede codificar datos base64 en este entorno.');
}

const PROVINCE_NAMES = new Set(
  [
    'a coruna',
    'alava',
    'araba',
    'albacete',
    'alicante',
    'almeria',
    'asturias',
    'avila',
    'badajoz',
    'barcelona',
    'burgos',
    'caceres',
    'cadiz',
    'cantabria',
    'castellon',
    'castello',
    'ceuta',
    'ciudad real',
    'cordoba',
    'cuenca',
    'girona',
    'gerona',
    'granada',
    'guadalajara',
    'gipuzkoa',
    'guipuzcoa',
    'huelva',
    'huesca',
    'illes balears',
    'islas baleares',
    'jaen',
    'la rioja',
    'las palmas',
    'leon',
    'lleida',
    'lerida',
    'lugo',
    'madrid',
    'malaga',
    'melilla',
    'murcia',
    'navarra',
    'ourense',
    'orense',
    'palencia',
    'pontevedra',
    'salamanca',
    'santa cruz de tenerife',
    'segovia',
    'sevilla',
    'soria',
    'tarragona',
    'teruel',
    'toledo',
    'valencia',
    'valladolid',
    'vizcaya',
    'bizkaia',
    'zamora',
    'zaragoza',
  ].map((name) =>
    name
      .toLocaleLowerCase('es-ES')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, ''),
  ),
);

function normaliseForComparison(value: string): string {
  return value
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function formatLocation(value: string | string[]): string {
  const items = Array.isArray(value) ? value : [value];
  const combined = items.map((item) => normaliseText(item)).filter(Boolean).join(', ');

  if (!combined) {
    return '';
  }

  const combinedLower = combined.toLocaleLowerCase('es-ES');
  if (combinedLower.includes('in company')) {
    return 'en sus instalaciones';
  }

  const segments = combined.split(',').map((segment) => normaliseText(segment)).filter(Boolean);

  for (const segment of segments) {
    const postalAndCityMatch = segment.match(/\b\d{5}\s+(.+)/u);
    if (postalAndCityMatch) {
      return normaliseText(postalAndCityMatch[1]);
    }
  }

  for (let index = 0; index < segments.length; index += 1) {
    if (/^\d{5}$/.test(segments[index])) {
      const nextSegment = segments
        .slice(index + 1)
        .find((item) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u.test(item));
      if (nextSegment) {
        return nextSegment;
      }
    }
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u.test(segment)) {
      continue;
    }
    const comparable = normaliseForComparison(segment);
    if (!comparable || PROVINCE_NAMES.has(comparable) || comparable === 'espana' || comparable === 'spain') {
      continue;
    }
    return segment;
  }

  const fallback = segments.find((segment) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u.test(segment));
  if (fallback) {
    return fallback;
  }

  return combined;
}

function assertCertificateData(data: CertificateGenerationData): void {
  if (!data || typeof data !== 'object') {
    throw new Error('No se han proporcionado datos para generar el certificado.');
  }

  const name = normaliseText(data.alumno?.nombre);
  const surname = normaliseText(data.alumno?.apellido);
  const dni = normaliseText(data.alumno?.dni);
  const sessionDate = normaliseText(data.sesion?.fecha_inicio_utc);
  const courseName = normaliseText(data.producto?.name);
  const hours = data.producto?.hours;

  if (!name || !surname || !dni) {
    throw new Error('Faltan datos del alumno para generar el certificado.');
  }

  if (!sessionDate) {
    throw new Error('Falta la fecha de la sesión para generar el certificado.');
  }

  if (!courseName || !Number.isFinite(hours) || (typeof hours === 'number' && hours <= 0)) {
    throw new Error('Faltan datos de la formación para generar el certificado.');
  }

  const sede = data.deal?.sede_labels;
  const formattedSede = Array.isArray(sede)
    ? sede.some((item) => normaliseText(item).length > 0)
    : normaliseText(sede).length > 0;
  if (!formattedSede) {
    throw new Error('Falta la sede para generar el certificado.');
  }
}

function buildCertificateDocDefinition(
  data: CertificateGenerationData,
  layoutAdjustments?: CertificateTextLayoutAdjustments,
): TDocumentDefinitions {
  const studentName = `${normaliseText(data.alumno.nombre)} ${normaliseText(data.alumno.apellido)}`.trim();
  const dni = normaliseText(data.alumno.dni);
  const formattedDate = formatDate(data.sesion.fecha_inicio_utc);
  const location = formatLocation(data.deal.sede_labels);
  const courseHours = formatHours(data.producto.hours);
  const courseName = normaliseText(data.producto.name);
  const theoreticalItems = ensureList(data.theoreticalItems);
  const practicalItems = ensureList(data.practicalItems);

  const styles: StyleDictionary = {
    bodyText: { fontSize: 8.5, lineHeight: 1.3 },
    studentInfoText: { fontSize: 8.5, lineHeight: 0.91 },
    certificateTitle: {
      fontSize: 28,
      bold: true,
      color: '#000000',
      lineHeight: 1.1,
      characterSpacing: 0.5,
    },
    courseName: { fontSize: 18, bold: true, margin: [0, 0, 0, 18], color: '#e8474d' },
    tableHeader: { fontSize: 9, bold: true, margin: [0, 0, 0, 8] },
    tableList: { fontSize: 7.5, lineHeight: 1.125 },
  };

  const content: Content[] = [];

  const textBlockAdjustments = layoutAdjustments?.textBlock ?? {};

  const lateralRightEdge = DEFAULT_LEFT_SIDEBAR_RIGHT_EDGE;
  const textHorizontalPlacement = resolveTextHorizontalPlacement(
    CERTIFICATE_ELEMENT_LAYOUT.textContent.horizontal,
    lateralRightEdge,
  );
  const textStartXBase = textHorizontalPlacement.x;
  const textWidthBase = textHorizontalPlacement.width;
  const textStartYBase = resolveVerticalPosition(CERTIFICATE_ELEMENT_LAYOUT.textContent.vertical, 0);

  const adjustedTextStartX = textStartXBase + (textBlockAdjustments.offsetX ?? 0);
  const boundedTextStartX = Math.max(0, Math.min(PAGE_WIDTH - MIN_TEXT_BLOCK_WIDTH, adjustedTextStartX));

  const adjustedTextWidth = Math.max(
    MIN_TEXT_BLOCK_WIDTH,
    textWidthBase + (textBlockAdjustments.widthDelta ?? 0),
  );
  const maxAvailableWidth = Math.max(MIN_TEXT_BLOCK_WIDTH, PAGE_WIDTH - boundedTextStartX);
  const textWidth = Math.min(adjustedTextWidth, maxAvailableWidth);

  const adjustedTextStartY = textStartYBase + (textBlockAdjustments.offsetY ?? 0);
  const textStartY = Math.max(0, Math.min(PAGE_HEIGHT, adjustedTextStartY));

  const stack: Content[] = [];

  stack.push({
    text: 'Sr. Lluís Vicent Pérez,\nDirector de la escuela GEPCO Formación\nexpide el presente:',
    style: 'bodyText',
    margin: [0, 0, 0, 12],
  });

  stack.push({ text: 'CERTIFICADO', style: 'certificateTitle', margin: [0, -5, 0, 16] });

  stack.push({
    text: [
      'A nombre del alumno/a ',
      { text: studentName, bold: true },
    ],
    style: 'studentInfoText',
    margin: [0, -5, 0, 6],
  });

  stack.push({
    text: [
      'con DNI/NIE ',
      { text: dni, bold: true },
      ', quien en fecha ',
      { text: formattedDate, bold: true },
      ' y en ',
      { text: location, bold: true },
    ],
    style: 'studentInfoText',
    margin: [0, -5, 0, 6],
  });

  stack.push({
    text: [
      'ha superado, con una duración total de ',
      { text: courseHours, bold: true },
      ' horas, la formación de:',
    ],
    style: 'studentInfoText',
    margin: [0, -5, 0, 12],
  });

  stack.push({ text: courseName, style: 'courseName' });

  const tableLayout = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingTop: () => TABLE_CELL_PADDING.top,
    paddingBottom: () => TABLE_CELL_PADDING.bottom,
    paddingLeft: () => TABLE_CELL_PADDING.left,
    paddingRight: () => TABLE_CELL_PADDING.right,
  };

  const theoreticalCellContent = theoreticalItems.length
    ? { ul: theoreticalItems, style: 'tableList', margin: [0, 0, PRACTICAL_COLUMN_LEFT_SHIFT, 0] }
    : { text: '—', style: 'tableList', margin: [0, 0, PRACTICAL_COLUMN_LEFT_SHIFT, 0] };

  const practicalCellContent = practicalItems.length
    ? { ul: practicalItems, style: 'tableList', margin: [-PRACTICAL_COLUMN_LEFT_SHIFT, 0, 0, 0] }
    : { text: '—', style: 'tableList', margin: [-PRACTICAL_COLUMN_LEFT_SHIFT, 0, 0, 0] };

  stack.push({
    table: {
      headerRows: 1,
      widths: ['*', '*'],
      body: [
        [
          { text: 'Contenido Teórico', style: 'tableHeader', margin: [0, 0, PRACTICAL_COLUMN_LEFT_SHIFT, 0] },
          { text: 'Contenido Práctico', style: 'tableHeader', margin: [-PRACTICAL_COLUMN_LEFT_SHIFT, 0, 0, 0] },
        ],
        [theoreticalCellContent, practicalCellContent],
      ],
    },
    layout: tableLayout,
  });

  content.push({
    absolutePosition: { x: boundedTextStartX, y: textStartY },
    width: textWidth,
    stack,
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [0, 0, 0, 0],
    defaultStyle: {
      font: 'Poppins',
      color: '#3a405a',
    },
    styles,
    content,
  };
}

async function getPdfMakeDocumentBytes(pdfDoc: unknown): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    if (!pdfDoc || typeof pdfDoc !== 'object') {
      reject(new Error('No se pudo generar el documento PDF.'));
      return;
    }

    const typedDoc = pdfDoc as {
      getBuffer?: (callback: (buffer: ArrayBuffer) => void) => void;
      getBlob?: (callback: (blob: Blob) => void) => void;
      getBase64?: (callback: (base64: string) => void) => void;
    };

    if (typeof typedDoc.getBuffer === 'function') {
      typedDoc.getBuffer((buffer) => {
        try {
          resolve(new Uint8Array(buffer));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error('No se pudo leer el PDF generado.'),
          );
        }
      });
      return;
    }

    if (typeof typedDoc.getBlob === 'function') {
      typedDoc.getBlob(async (blob) => {
        try {
          const arrayBuffer = await blob.arrayBuffer();
          resolve(new Uint8Array(arrayBuffer));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error('No se pudo convertir el PDF generado.'),
          );
        }
      });
      return;
    }

    if (typeof typedDoc.getBase64 === 'function') {
      typedDoc.getBase64((base64) => {
        try {
          resolve(base64ToUint8Array(base64));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error('No se pudo decodificar el PDF generado.'),
          );
        }
      });
      return;
    }

    reject(new Error('El generador de PDF no proporciona un método de extracción compatible.'));
  });
}

async function mergeCertificateWithTemplate(textPdfBytes: Uint8Array): Promise<Uint8Array> {
  const templateBytes = await loadCertificateTemplateBytes();
  const templateDocument = await PDFDocument.load(templateBytes);
  const [embeddedPage] = await templateDocument.embedPdf(textPdfBytes);
  const [templatePage] = templateDocument.getPages();
  const { width, height } = templatePage.getSize();

  templatePage.drawPage(embeddedPage, {
    x: 0,
    y: 0,
    width,
    height,
  });

  return templateDocument.save();
}

async function renderCertificatePdfBytes(
  docDefinition: TDocumentDefinitions,
): Promise<Uint8Array> {
  const pdfMakeInstance = await getPdfMakeInstance();
  const pdfDoc = pdfMakeInstance.createPdf(docDefinition);
  const textBytes = await getPdfMakeDocumentBytes(pdfDoc);
  return mergeCertificateWithTemplate(textBytes);
}

export async function generateCertificatePDF(
  data: CertificateGenerationData,
  layoutAdjustments?: CertificateTextLayoutAdjustments,
): Promise<Blob> {
  assertCertificateData(data);

  const docDefinition = buildCertificateDocDefinition(data, layoutAdjustments);

  try {
    const pdfBytes = await renderCertificatePdfBytes(docDefinition);
    return new Blob([pdfBytes], { type: 'application/pdf' });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error desconocido generando el certificado.');
  }
}

export async function generateCertificateTemplatePreviewDataUrl(
  options?: CertificateTemplatePreviewOptions,
): Promise<string> {
  const previewTheory = ensureList(options?.theoreticalItems);
  const previewPractice = ensureList(options?.practicalItems);

  const previewData: CertificateGenerationData = {
    alumno: { ...PREVIEW_SAMPLE_DATA.alumno },
    sesion: { ...PREVIEW_SAMPLE_DATA.sesion },
    deal: { ...PREVIEW_SAMPLE_DATA.deal },
    producto: {
      name: normaliseText(options?.courseName) || PREVIEW_SAMPLE_DATA.producto.name,
      hours:
        typeof options?.hours === 'number' && Number.isFinite(options.hours)
          ? options.hours
          : PREVIEW_SAMPLE_DATA.producto.hours,
    },
    theoreticalItems: previewTheory.length ? previewTheory : PREVIEW_SAMPLE_DATA.theoreticalItems,
    practicalItems: previewPractice.length ? previewPractice : PREVIEW_SAMPLE_DATA.practicalItems,
  };

  assertCertificateData(previewData);

  try {
    const docDefinition = buildCertificateDocDefinition(
      previewData,
      options?.layoutAdjustments,
    );
    const pdfBytes = await renderCertificatePdfBytes(docDefinition);
    const base64 = uint8ArrayToBase64(pdfBytes);
    if (!base64) {
      throw new Error('No se ha podido generar la previsualización del certificado.');
    }
    return `data:application/pdf;base64,${base64}`;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error generando la previsualización del certificado.');
  }
}
