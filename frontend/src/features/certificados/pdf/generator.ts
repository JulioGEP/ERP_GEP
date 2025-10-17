import type { TDocumentDefinitions } from 'pdfmake/interfaces';
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
  manualText?: string;
}

type TemplateIds = 'CERT-PAUX-EI' | 'CERT-PACK' | 'CERT-GENERICO';

export type CertificateTemplateKey = TemplateIds;

const CERTIFICATE_TEMPLATE_LABELS: Record<CertificateTemplateKey, string> = {
  'CERT-GENERICO': 'Genérico',
  'CERT-PAUX-EI': 'Auxiliar Educación Infantil',
  'CERT-PACK': 'Pack / Combo',
};

export type CertificateTemplateOption = {
  key: CertificateTemplateKey;
  label: string;
};

export const CERTIFICATE_TEMPLATE_OPTIONS: CertificateTemplateOption[] = (
  Object.keys(CERTIFICATE_TEMPLATE_LABELS) as CertificateTemplateKey[]
).map((key) => ({
  key,
  label: CERTIFICATE_TEMPLATE_LABELS[key],
}));

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NkYGD4DwABBAEAi5JBSwAAAABJRU5ErkJggg==';

// =========================
// Certificado - pdfMake nodes (con variables + templates)
// =========================

type DomainData = {
  alumnos: { nombre: string; apellido?: string; dni: string };
  sesiones: { fecha_inicio_utc: string };
  deals: { sede_labels: string | string[] };
  deal_products: { name: string; hours: number };
  theoreticalItems: string[];
  practicalItems: string[];
  manualText: string;
};

type TemplateImages = {
  'fondo-certificado.png'?: string;
  'lateral-izquierdo.png'?: string;
  'logo-certificado.png'?: string;
  'pie-firma.png'?: string;
  [key: string]: string | undefined;
  '__px.png': string;
};

export function buildCertificateDocFromDomain(
  data: DomainData,
  images: TemplateImages,
  templateOverride?: TemplateIds,
): TDocumentDefinitions {
  // ---- 0) Selección de template a partir de deal_products.name ----
  const templateId = templateOverride ?? detectCertificateTemplate(data.deal_products.name);

  // Utilidad para escoger imagen por template (si existe) o fallback genérico
  function pickImg(
    file:
      | 'fondo-certificado.png'
      | 'lateral-izquierdo.png'
      | 'logo-certificado.png'
      | 'pie-firma.png',
  ): string {
    return images[`${templateId}/${file}`] || images[file] || images['__px.png'];
  }

  // ---- 1) Geometría y constantes del layout ----
  const PAGE = { width: 841.89, height: 595.28 };
  const MARGINS = { left: 60, top: 50, right: 70, bottom: 60 };
  const INNER = {
    x0: MARGINS.left,
    y0: MARGINS.top,
    x1: PAGE.width - MARGINS.right,
    y1: PAGE.height - MARGINS.bottom,
    width: PAGE.width - MARGINS.left - MARGINS.right,
    height: PAGE.height - MARGINS.top - MARGINS.bottom,
  };
  const LEFT_PANEL_WIDTH = Math.max(INNER.width * 0.55, 240);
  const GUTTER = 36;
  const RIGHT_COL = {
    x: INNER.x0 + LEFT_PANEL_WIDTH + GUTTER,
    y: INNER.y0,
    width: INNER.width - LEFT_PANEL_WIDTH - GUTTER,
    height: INNER.height,
  };

  // ---- 2) Helpers de formato ----
  function toDDMMYYYY(s: string): string {
    if (!s) return '';
    const iso = s.includes('-') && s.split('-')[0].length === 4;
    if (iso) {
      const [Y, M, D] = s.split('-');
      return `${D.padStart(2, '0')}-${M.padStart(2, '0')}-${Y}`;
    }
    if (s.includes('/')) {
      const [D, M, Y] = s.split('/');
      return `${D.padStart(2, '0')}-${M.padStart(2, '0')}-${Y}`;
    }
    return s.replace(/\//g, '-');
  }
  function sedeToUpper(sede: string | string[]): string {
    const raw = Array.isArray(sede) ? sede.join(', ') : sede || '';
    return raw.toUpperCase();
  }
  function estimateParagraphHeight(text: string, width: number, fontSize: number, lineHeight: number): number {
    const avgCharsPerLine = Math.max(10, Math.floor(width / (fontSize * 0.55)));
    const lines = Math.max(1, Math.ceil((text || '').length / avgCharsPerLine));
    return lines * (fontSize * lineHeight);
  }
  function estimateListHeight(
    items: string[],
    width: number,
    fontSize: number,
    lineHeight: number,
    itemSpacingBottom: number,
    bulletIndent: number,
  ): number {
    let h = 0;
    const innerWidth = width - bulletIndent;
    for (const t of items || []) {
      h += estimateParagraphHeight(t, innerWidth, fontSize, lineHeight) + itemSpacingBottom;
    }
    return h;
  }

  // ---- 3) Estilos ----
  const styles = {
    certificateTitle: { fontSize: 42, bold: true, alignment: 'center', margin: [0, 0, 0, 14], characterSpacing: 0.5 },
    bodyText: { fontSize: 13.5, lineHeight: 1.15, margin: [0, 0, 0, 8] },
    highlightName: { fontSize: 19, bold: true, margin: [0, 0, 0, 6] },
    courseTitle: { fontSize: 16, bold: true, margin: [0, 0, 0, 0] },

    sectionHeader: { fontSize: 14.5, bold: true, margin: [0, 0, 0, 6] },
    listItem: { fontSize: 12.5, lineHeight: 1.18, margin: [0, 0, 0, 2] },
    manualHeader: { fontSize: 13.5, bold: true, margin: [0, 8, 0, 4] },
    manualText: { fontSize: 12.5, lineHeight: 1.18 },
  } as const;

  const BULLET_INDENT = 14;
  const HEADER_H = styles.sectionHeader.fontSize * 1.1 + 6;
  const MANUAL_HDR_H = styles.manualHeader.fontSize * 1.1 + 4;

  // ---- 4) Imágenes absolutas (orden de dibujo) ----
  const FOOTER_WIDTH = INNER.width;
  const FOOTER_HEIGHT = 100;
  const SAFE_BOTTOM_Y = INNER.y1 - 8;
  const CONTENT_BOTTOM_LIMIT = SAFE_BOTTOM_Y - FOOTER_HEIGHT;

  const absoluteImages = [
    {
      image: pickImg('fondo-certificado.png'),
      absolutePosition: { x: RIGHT_COL.x, y: RIGHT_COL.y },
      width: RIGHT_COL.width,
      opacity: 1,
    },
    {
      image: pickImg('lateral-izquierdo.png'),
      absolutePosition: { x: INNER.x0, y: INNER.y0 },
      width: 70,
    },
    {
      image: pickImg('pie-firma.png'),
      absolutePosition: { x: INNER.x0, y: INNER.y1 - FOOTER_HEIGHT },
      width: FOOTER_WIDTH,
    },
  ];

  // ---- 5) Panel izquierdo (logo)
  const leftStack = [{ image: pickImg('logo-certificado.png'), width: 180, margin: [0, 40, 0, 12] }];

  // ---- 6) Texto institucional EXACTO + variables ----
  const fechaStr = toDDMMYYYY(data.sesiones.fecha_inicio_utc);
  const localidadStr = sedeToUpper(data.deals.sede_labels);
  const alumnoFull = `${data.alumnos.nombre ?? ''} ${data.alumnos.apellido ?? ''}`.trim();

  const rightIntroStack = [
    {
      text: 'Sr. Lluís Vicent Pérez,\nDirector de la escuela GEPCO Formación\nexpide el presente:',
      style: 'bodyText',
      margin: [0, 0, 0, 8],
    },
    { text: 'CERTIFICADO', style: 'certificateTitle' },
    { text: `A nombre del alumno/a ${alumnoFull}`, style: 'highlightName' },
    { text: `con ${data.alumnos.dni}, quien en fecha ${fechaStr} y en ${localidadStr}`, style: 'bodyText', margin: [0, 0, 0, 2] },
    {
      text: `ha superado, con una duración total de ${data.deal_products.hours} horas, la formación de:`,
      style: 'bodyText',
      margin: [0, 0, 0, 10],
    },
    { text: data.deal_products.name || '', style: 'courseTitle' },
  ];

  // ---- 7) Sub-bloques (Teóricos → Prácticos → Manual) ----
  const THEORETICALS_START_Y = RIGHT_COL.y + 210;

  const LI_FS = styles.listItem.fontSize;
  const LI_LH = styles.listItem.lineHeight as number;
  const LI_SP = 2;

  const theorHeaderH = HEADER_H;
  const theorListH = estimateListHeight(
    data.theoreticalItems,
    RIGHT_COL.width,
    LI_FS,
    LI_LH,
    LI_SP,
    BULLET_INDENT,
  );
  const theorTotalH = theorHeaderH + theorListH;
  const yPractStart = THEORETICALS_START_Y + theorTotalH + 10;

  const practHeaderH = HEADER_H;
  const practListH = estimateListHeight(
    data.practicalItems,
    RIGHT_COL.width,
    LI_FS,
    LI_LH,
    LI_SP,
    BULLET_INDENT,
  );
  const practTotalH = practHeaderH + practListH;
  const yManualStart = yPractStart + practTotalH + 10;

  const manualHdrH = MANUAL_HDR_H;
  const manualTxtH = estimateParagraphHeight(
    data.manualText || '',
    RIGHT_COL.width,
    styles.manualText.fontSize,
    styles.manualText.lineHeight as number,
  );
  const manualTotalH = manualHdrH + manualTxtH;

  function assertFits(yStart: number, blockHeight: number, label: string) {
    if (yStart + blockHeight > CONTENT_BOTTOM_LIMIT) {
      throw new Error(
        `[${label}] sobrepasa el límite inferior por pie-firma. Compacta tipografía o salta el MANUAL a la página 2.`,
      );
    }
  }
  assertFits(THEORETICALS_START_Y, theorTotalH, 'Módulos teóricos');
  assertFits(yPractStart, practTotalH, 'Módulos prácticos');
  assertFits(yManualStart, manualTotalH, 'Manual de contenidos');

  const theoreticalBlock = {
    absolutePosition: { x: RIGHT_COL.x, y: THEORETICALS_START_Y },
    width: RIGHT_COL.width,
    stack: [
      { text: 'Módulos teóricos', style: 'sectionHeader' },
      { ul: data.theoreticalItems || [], style: 'listItem', margin: [BULLET_INDENT, 0, 0, 0] },
    ],
  };
  const practicalBlock = {
    absolutePosition: { x: RIGHT_COL.x, y: yPractStart },
    width: RIGHT_COL.width,
    stack: [
      { text: 'Módulos prácticos', style: 'sectionHeader' },
      { ul: data.practicalItems || [], style: 'listItem', margin: [BULLET_INDENT, 0, 0, 0] },
    ],
  };
  const manualBlock = {
    absolutePosition: { x: RIGHT_COL.x, y: yManualStart },
    width: RIGHT_COL.width,
    stack: [
      { text: 'Manual de contenidos', style: 'manualHeader' },
      { text: data.manualText || '', style: 'manualText' },
    ],
  };

  // ---- 8) DocDefinition con fuentes embebidas (Poppins) ----
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [MARGINS.left, MARGINS.top, MARGINS.right, MARGINS.bottom],
    defaultStyle: { font: 'Poppins', fontSize: 12, color: '#0B0B0B' },
    background: undefined,

    images: {
      'fondo-certificado.png': pickImg('fondo-certificado.png'),
      'lateral-izquierdo.png': pickImg('lateral-izquierdo.png'),
      'logo-certificado.png': pickImg('logo-certificado.png'),
      'pie-firma.png': pickImg('pie-firma.png'),
      '__px.png': images['__px.png'],
    },

    styles,

    content: [
      ...absoluteImages,
      { absolutePosition: { x: INNER.x0, y: INNER.y0 }, width: LEFT_PANEL_WIDTH, stack: leftStack },
      { absolutePosition: { x: RIGHT_COL.x, y: RIGHT_COL.y }, width: RIGHT_COL.width, stack: rightIntroStack },
      theoreticalBlock,
      practicalBlock,
      manualBlock,
    ],
  } as unknown as TDocumentDefinitions;

  return docDefinition;
}

// =========================
// Detección de template por nombre de producto
// =========================
function detectCertificateTemplate(productName: string): TemplateIds {
  const name = (productName || '').toUpperCase();

  if (/\bPAUX\b/.test(name) || /\bPAU[XÇ]\b/.test(name)) return 'CERT-PAUX-EI';
  if (/\bPACK\b/.test(name) || /\bPACK\s+EMERGENCIAS\b/.test(name)) return 'CERT-PACK';

  return 'CERT-GENERICO';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function assertCertificateData(data: CertificateGenerationData): asserts data is CertificateGenerationData {
  if (!data || typeof data !== 'object') {
    throw new Error('No se han proporcionado datos para generar el certificado.');
  }

  const { alumno, sesion, deal, producto } = data;

  if (!alumno || !hasText(alumno.nombre) || !hasText(alumno.apellido) || !hasText(alumno.dni)) {
    throw new Error('Faltan datos del alumno para generar el certificado.');
  }

  if (!sesion || !hasText(sesion.fecha_inicio_utc)) {
    throw new Error('Falta la fecha de la sesión para generar el certificado.');
  }

  if (
    !deal ||
    (!hasText(deal.sede_labels) &&
      !(Array.isArray(deal.sede_labels) && deal.sede_labels.some((item) => hasText(item))))
  ) {
    throw new Error('Falta la sede para generar el certificado.');
  }

  if (!producto || !isPositiveNumber(producto.hours) || !hasText(producto.name)) {
    throw new Error('Faltan datos de la formación para generar el certificado.');
  }
}

function toDomainData(data: CertificateGenerationData): DomainData {
  return {
    alumnos: {
      nombre: data.alumno.nombre,
      apellido: data.alumno.apellido,
      dni: data.alumno.dni,
    },
    sesiones: {
      fecha_inicio_utc: data.sesion.fecha_inicio_utc,
    },
    deals: {
      sede_labels: data.deal.sede_labels,
    },
    deal_products: {
      name: data.producto.name,
      hours: data.producto.hours,
    },
    theoreticalItems: data.theoreticalItems ?? [],
    practicalItems: data.practicalItems ?? [],
    manualText: data.manualText ?? '',
  };
}

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
  manualText:
    'El manual recoge los procedimientos operativos, normativa aplicable y recursos de apoyo para la formación.',
};

const PREVIEW_PRODUCT_NAMES: Record<TemplateIds, string> = {
  'CERT-GENERICO': 'Formación genérica de ejemplo',
  'CERT-PAUX-EI': 'Auxiliar Educación Infantil (PAUX EI)',
  'CERT-PACK': 'Pack Emergencias',
};

function buildTemplateImages(): TemplateImages {
  const fondo = getCertificateImageDataUrl('background');
  const lateral = getCertificateImageDataUrl('leftSidebar');
  const logo = getCertificateImageDataUrl('logo');
  const pie = getCertificateImageDataUrl('footer');

  return {
    'fondo-certificado.png': fondo ?? TRANSPARENT_PIXEL,
    'lateral-izquierdo.png': lateral ?? TRANSPARENT_PIXEL,
    'logo-certificado.png': logo ?? TRANSPARENT_PIXEL,
    'pie-firma.png': pie ?? TRANSPARENT_PIXEL,
    '__px.png': TRANSPARENT_PIXEL,
  };
}

export function resolveCertificateTemplateKey(productName: string): CertificateTemplateKey {
  return detectCertificateTemplate(productName);
}

export async function generateCertificatePDF(
  data: CertificateGenerationData,
  options?: { templateKey?: CertificateTemplateKey; images?: TemplateImages },
): Promise<Blob> {
  assertCertificateData(data);

  const pdfMakeInstance = await getPdfMakeInstance();
  const domainData = toDomainData(data);
  const images = options?.images ?? buildTemplateImages();
  const templateId = options?.templateKey ?? detectCertificateTemplate(domainData.deal_products.name);
  const docDefinition = buildCertificateDocFromDomain(domainData, images, templateId);

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
      reject(error instanceof Error ? error : new Error('Error desconocido generando el certificado.'));
    }
  });
}

export async function generateCertificateTemplatePreviewDataUrl(
  templateKey: CertificateTemplateKey,
): Promise<string> {
  const pdfMakeInstance = await getPdfMakeInstance();
  const images = buildTemplateImages();
  const previewData: CertificateGenerationData = {
    ...PREVIEW_SAMPLE_DATA,
    producto: {
      ...PREVIEW_SAMPLE_DATA.producto,
      name: PREVIEW_PRODUCT_NAMES[templateKey] ?? PREVIEW_SAMPLE_DATA.producto.name,
    },
  };
  const domainData = toDomainData(previewData);
  const docDefinition = buildCertificateDocFromDomain(domainData, images, templateKey);

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
