import type { Content, StyleDictionary, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  getCertificateImageDataUrl,
  getPdfMakeInstance,
} from '../lib/pdf/pdfmake-initializer';

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

export type CertificateTemplatePreviewOptions = {
  courseName?: string;
  theoreticalItems?: string[];
  practicalItems?: string[];
  hours?: number;
};

type CertificatePdfImages = {
  background: string | null;
  leftSidebar: string | null;
  footer: string | null;
  logo: string | null;
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
const PRACTICAL_COLUMN_LEFT_SHIFT = 15;
const TABLE_CELL_PADDING = {
  left: 12,
  right: 12,
  top: 6,
  bottom: 6,
} as const;

const IMAGE_DIMENSIONS = {
  background: { width: 839, height: 1328 },
  leftSidebar: { width: 85, height: 1241 },
  footer: { width: 853, height: 153 },
  logo: { width: 827, height: 382 },
} as const;

const BACKGROUND_WIDTH_SCALE = 0.5;
const LEFT_SIDEBAR_HEIGHT_SCALE = 1.4;
const LEFT_SIDEBAR_HORIZONTAL_SHIFT = 10;

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

function loadCertificateImages(): CertificatePdfImages {
  return {
    background: getCertificateImageDataUrl('background'),
    leftSidebar: getCertificateImageDataUrl('leftSidebar'),
    footer: getCertificateImageDataUrl('footer'),
    logo: getCertificateImageDataUrl('logo'),
  };
}

function buildCertificateDocDefinition(
  data: CertificateGenerationData,
  images: CertificatePdfImages,
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
    courseName: { fontSize: 14, bold: true, margin: [0, 0, 0, 18], color: '#ff0000' },
    tableHeader: { fontSize: 9, bold: true, margin: [0, 0, 0, 8] },
    tableList: { fontSize: 7.5, lineHeight: 1.125 },
  };

  const content: Content[] = [];

  if (images.background) {
    const height = PAGE_HEIGHT;
    const baseWidth =
      (IMAGE_DIMENSIONS.background.width / IMAGE_DIMENSIONS.background.height) * height;
    const width = baseWidth * BACKGROUND_WIDTH_SCALE;
    const x = PAGE_WIDTH - width + RIGHT_BLEED - BACKGROUND_LEFT_SHIFT;
    const y = 0;
    content.push({
      image: images.background,
      width,
      height,
      absolutePosition: { x, y },
    });
  }

  let lateralRightEdge = 40;

  if (images.leftSidebar) {
    const baseHeight = PAGE_HEIGHT * LEFT_SIDEBAR_HEIGHT_SCALE * LEFT_SIDEBAR_SIZE_REDUCTION;
    const baseScale = baseHeight / IMAGE_DIMENSIONS.leftSidebar.height;
    const baseWidth = IMAGE_DIMENSIONS.leftSidebar.width * baseScale;
    const x =
      -baseWidth * LEFT_OFFSET_RATIO * LEFT_EXTRA_OFFSET_RATIO -
      LEFT_SIDEBAR_HORIZONTAL_SHIFT +
      LEFT_SIDEBAR_RIGHT_SHIFT;
    const height = baseHeight;
    const width = baseWidth;
    const y = -(height - PAGE_HEIGHT) / 2;
    lateralRightEdge = x + width;
    content.push({
      image: images.leftSidebar,
      height,
      width,
      absolutePosition: { x, y },
    });
  }

  if (images.footer) {
    const availableWidth = PAGE_WIDTH;
    const scale = (availableWidth / IMAGE_DIMENSIONS.footer.width) * 0.8 * FOOTER_SIZE_REDUCTION;
    const height = IMAGE_DIMENSIONS.footer.height * scale;
    const width = IMAGE_DIMENSIONS.footer.width * scale;
    const y = PAGE_HEIGHT - height - 8;
    const footerX = (PAGE_WIDTH - width) / 2;
    content.push({
      image: images.footer,
      width,
      absolutePosition: { x: footerX, y },
    });
  }

  const textStartX = Math.max(lateralRightEdge + 10, 60);
  const textWidth = Math.max(260, PAGE_WIDTH - textStartX - TEXT_RIGHT_MARGIN);

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
    absolutePosition: { x: textStartX, y: DEFAULT_TEXT_START_Y },
    width: textWidth,
    stack,
  });

  if (images.logo) {
    const scale = LOGO_TARGET_WIDTH / IMAGE_DIMENSIONS.logo.width;
    const width = LOGO_TARGET_WIDTH;
    const height = IMAGE_DIMENSIONS.logo.height * scale;
    const x = PAGE_WIDTH - width - 10;
    const y = (PAGE_HEIGHT - height) / 2;
    content.push({
      image: images.logo,
      width,
      height,
      absolutePosition: { x, y },
    });
  }

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

export async function generateCertificatePDF(data: CertificateGenerationData): Promise<Blob> {
  assertCertificateData(data);

  const pdfMakeInstance = await getPdfMakeInstance();
  const images = loadCertificateImages();
  const docDefinition = buildCertificateDocDefinition(data, images);

  return new Promise<Blob>((resolve, reject) => {
    try {
      const pdfDoc = pdfMakeInstance.createPdf(docDefinition);
      pdfDoc.getBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('No se ha podido generar el PDF del certificado.'));
        }
      });
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error('Error desconocido generando el certificado.'),
      );
    }
  });
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

  const pdfMakeInstance = await getPdfMakeInstance();
  const images = loadCertificateImages();
  const docDefinition = buildCertificateDocDefinition(previewData, images);

  return new Promise<string>((resolve, reject) => {
    try {
      const pdfDoc = pdfMakeInstance.createPdf(docDefinition);
      pdfDoc.getDataUrl((dataUrl) => {
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          resolve(dataUrl);
        } else {
          reject(new Error('No se ha podido generar la previsualización del certificado.'));
        }
      });
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error('Error generando la previsualización del certificado.'),
      );
    }
  });
}
