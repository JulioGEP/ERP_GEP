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
  const PAGE = { width: 842, height: 596 };
  const INSTITUTION_BLOCK = { x: 71.1, y: 61.04, width: 435.29 };
  const CENTRAL_IMAGE_BOUNDS = {
    x: 65.1,
    y: 281.39,
    width: 552.75,
    height: 159.75,
  };
  const RIGHT_PANEL_BOUNDS = {
    x: 636.6,
    y: 266.5,
    width: 176.25,
    height: 81.75,
  };
  const FOOTER_BOUNDS = {
    x: 71.1,
    y: 463.88,
    width: 639.75,
    height: 114,
  };
  const CONTENT_BOTTOM_LIMIT = 455.88;

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
  function resolveMargin(margin?: number | number[]): [number, number, number, number] {
    if (typeof margin === 'number') {
      return [margin, margin, margin, margin];
    }
    if (!margin) {
      return [0, 0, 0, 0];
    }
    if (margin.length === 2) {
      return [margin[0], margin[1], margin[0], margin[1]];
    }
    if (margin.length === 4) {
      return margin as [number, number, number, number];
    }
    return [0, 0, 0, 0];
  }
  function estimateParagraphHeight(text: string, width: number, fontSize: number, lineHeight: number): number {
    const segments = (text || '').split(/\n/);
    if (segments.length === 0) {
      return fontSize * lineHeight;
    }
    return segments.reduce((acc, segment) => {
      const avgCharsPerLine = Math.max(10, Math.floor(width / (fontSize * 0.55)));
      const lines = Math.max(1, Math.ceil((segment || '').length / avgCharsPerLine));
      return acc + lines * (fontSize * lineHeight);
    }, 0);
  }
  function estimateListHeight(
    items: string[],
    width: number,
    fontSize: number,
    lineHeight: number,
    itemSpacingBottom: number,
    bulletIndent: number,
  ): number {
    if (!items || items.length === 0) {
      return 0;
    }
    let h = 0;
    const innerWidth = width - bulletIndent;
    for (const t of items) {
      h += estimateParagraphHeight(t, innerWidth, fontSize, lineHeight) + itemSpacingBottom;
    }
    return h;
  }

  // ---- 3) Estilos ----
  const styles = {
    certificateTitle: {
      fontSize: 42,
      bold: true,
      alignment: 'center',
      margin: [0, 0, 0, 19],
      characterSpacing: 0.5,
    },
    bodyText: { fontSize: 13.5, lineHeight: 1.15, margin: [0, 0, 0, 10] },
    highlightName: { fontSize: 19, bold: true, margin: [0, 0, 0, 10] },
    courseTitle: { fontSize: 18.5, bold: true, margin: [0, 0, 0, 0] },

    sectionHeader: { fontSize: 14.5, bold: true, margin: [0, 0, 0, 6] },
    listItem: { fontSize: 12.5, lineHeight: 1.18, margin: [0, 0, 0, 2] },
    manualHeader: { fontSize: 13.5, bold: true, margin: [0, 8, 0, 4] },
    manualText: { fontSize: 12.5, lineHeight: 1.18 },
  } as const;

  const BULLET_INDENT = 14;

  // ---- 4) Imágenes absolutas (orden de dibujo) ----
  const absoluteImages = [
    {
      image: pickImg('fondo-certificado.png'),
      absolutePosition: { x: CENTRAL_IMAGE_BOUNDS.x, y: CENTRAL_IMAGE_BOUNDS.y },
      width: CENTRAL_IMAGE_BOUNDS.width,
      height: CENTRAL_IMAGE_BOUNDS.height,
      opacity: 1,
    },
    {
      image: pickImg('lateral-izquierdo.png'),
      absolutePosition: { x: RIGHT_PANEL_BOUNDS.x, y: RIGHT_PANEL_BOUNDS.y },
      width: RIGHT_PANEL_BOUNDS.width,
      height: RIGHT_PANEL_BOUNDS.height,
    },
    {
      image: pickImg('pie-firma.png'),
      absolutePosition: { x: FOOTER_BOUNDS.x, y: FOOTER_BOUNDS.y },
      width: FOOTER_BOUNDS.width,
      height: FOOTER_BOUNDS.height,
    },
  ];

  const logoImage = pickImg('logo-certificado.png');
  const hasLogo = logoImage !== images['__px.png'];

  // ---- 5) Texto institucional EXACTO + variables ----
  const fechaStr = toDDMMYYYY(data.sesiones.fecha_inicio_utc);
  const localidadStr = sedeToUpper(data.deals.sede_labels);
  const alumnoFull = `${data.alumnos.nombre ?? ''} ${data.alumnos.apellido ?? ''}`.trim();

  const institutionStack = [
    {
      text: 'Sr. Lluís Vicent Pérez,
Director de la escuela GEPCO Formación
expide el presente:',
      style: 'bodyText',
      margin: [0, 0, 0, 16],
    },
    { text: 'CERTIFICADO', style: 'certificateTitle' },
    { text: `A nombre del alumno/a ${alumnoFull}`, style: 'highlightName' },
    {
      text: `con ${data.alumnos.dni}, quien en fecha ${fechaStr} y en ${localidadStr}`,
      style: 'bodyText',
      margin: [0, 0, 0, 12],
    },
    {
      text: `ha superado, con una duración total de ${data.deal_products.hours} horas, la formación de:`,
      style: 'bodyText',
      margin: [0, 0, 0, 14],
    },
    { text: data.deal_products.name || '', style: 'courseTitle' },
  ] as const;

  type TextNode = {
    text: string;
    style: keyof typeof styles;
    margin?: number | [number, number, number, number];
  };

  function computeTextNodeHeight(node: TextNode, width: number): number {
    const style = styles[node.style];
    const margin = resolveMargin(node.margin ?? style.margin);
    const fontSize = (style.fontSize as number) ?? 12;
    const lineHeight = (style.lineHeight as number) ?? 1;
    const textHeight = estimateParagraphHeight(node.text, width, fontSize, lineHeight);
    return margin[1] + textHeight + margin[3];
  }

  const institutionStackHeight = institutionStack.reduce(
    (acc, node) => acc + computeTextNodeHeight(node, INSTITUTION_BLOCK.width),
    0,
  );

  // ---- 6) Sub-bloques (Teóricos → Prácticos → Manual) ----
  function computeListNodeHeight(
    items: string[] | undefined,
    width: number,
    marginOverride: number | [number, number, number, number] | undefined,
  ): number {
    const listStyle = styles.listItem;
    const listMargin = resolveMargin(marginOverride ?? listStyle.margin);
    const fontSize = (listStyle.fontSize as number) ?? 12;
    const lineHeight = (listStyle.lineHeight as number) ?? 1;
    const itemSpacingBottom = resolveMargin(listStyle.margin)[3];
    const listHeight = estimateListHeight(
      items ?? [],
      width,
      fontSize,
      lineHeight,
      itemSpacingBottom,
      BULLET_INDENT,
    );
    return listMargin[1] + listHeight + listMargin[3];
  }

  const minimumTheoreticalStartY = 267.39;
  const theoreticalStartY = Math.max(
    INSTITUTION_BLOCK.y + institutionStackHeight + 10,
    minimumTheoreticalStartY,
  );

  const theoreticalHeaderHeight = computeTextNodeHeight(
    { text: 'Módulos teóricos', style: 'sectionHeader' },
    INSTITUTION_BLOCK.width,
  );
  const theoreticalListHeight = computeListNodeHeight(
    data.theoreticalItems,
    INSTITUTION_BLOCK.width,
    [BULLET_INDENT, 0, 0, 0],
  );
  const theorTotalH = theoreticalHeaderHeight + theoreticalListHeight;
  const yPractStart = theoreticalStartY + theorTotalH + 10;

  const practicalHeaderHeight = computeTextNodeHeight(
    { text: 'Módulos prácticos', style: 'sectionHeader' },
    INSTITUTION_BLOCK.width,
  );
  const practicalListHeight = computeListNodeHeight(
    data.practicalItems,
    INSTITUTION_BLOCK.width,
    [BULLET_INDENT, 0, 0, 0],
  );
  const practTotalH = practicalHeaderHeight + practicalListHeight;
  const yManualStart = yPractStart + practTotalH + 10;

  const manualHeaderHeight = computeTextNodeHeight(
    { text: 'Manual de contenidos', style: 'manualHeader' },
    INSTITUTION_BLOCK.width,
  );
  const manualTextHeight = computeTextNodeHeight(
    { text: data.manualText || '', style: 'manualText' },
    INSTITUTION_BLOCK.width,
  );
  const manualTotalH = manualHeaderHeight + manualTextHeight;

  function assertFits(yStart: number, blockHeight: number, label: string) {
    if (yStart + blockHeight > CONTENT_BOTTOM_LIMIT) {
      throw new Error(
        `[${label}] sobrepasa el límite inferior por pie-firma. Compacta tipografía o salta el MANUAL a la página 2.`,
      );
    }
  }
  assertFits(theoreticalStartY, theorTotalH, 'Módulos teóricos');
  assertFits(yPractStart, practTotalH, 'Módulos prácticos');
  assertFits(yManualStart, manualTotalH, 'Manual de contenidos');

  const theoreticalBlock = {
    absolutePosition: { x: INSTITUTION_BLOCK.x, y: theoreticalStartY },
    width: INSTITUTION_BLOCK.width,
    stack: [
      { text: 'Módulos teóricos', style: 'sectionHeader' },
      { ul: data.theoreticalItems || [], style: 'listItem', margin: [BULLET_INDENT, 0, 0, 0] },
    ],
  };
  const practicalBlock = {
    absolutePosition: { x: INSTITUTION_BLOCK.x, y: yPractStart },
    width: INSTITUTION_BLOCK.width,
    stack: [
      { text: 'Módulos prácticos', style: 'sectionHeader' },
      { ul: data.practicalItems || [], style: 'listItem', margin: [BULLET_INDENT, 0, 0, 0] },
    ],
  };
  const manualBlock = {
    absolutePosition: { x: INSTITUTION_BLOCK.x, y: yManualStart },
    width: INSTITUTION_BLOCK.width,
    stack: [
      { text: 'Manual de contenidos', style: 'manualHeader' },
      { text: data.manualText || '', style: 'manualText' },
    ],
  };

  const logoBlock = hasLogo
    ? {
        image: logoImage,
        absolutePosition: { x: INSTITUTION_BLOCK.x, y: 15 },
        width: 180,
      }
    : null;

  // ---- 7) DocDefinition con fuentes embebidas (Poppins) ----
  const docDefinition: TDocumentDefinitions = {
    pageSize: { width: PAGE.width, height: PAGE.height },
    pageOrientation: 'landscape',
    pageMargins: [0, 0, 0, 0],
    defaultStyle: { font: 'Poppins', fontSize: 12, color: '#0B0B0B' },
    background: undefined,

    images: {
      'fondo-certificado.png': pickImg('fondo-certificado.png'),
      'lateral-izquierdo.png': pickImg('lateral-izquierdo.png'),
      'logo-certificado.png': logoImage,
      'pie-firma.png': pickImg('pie-firma.png'),
      '__px.png': images['__px.png'],
    },

    styles,

    content: [
      ...absoluteImages,
      ...(logoBlock ? [logoBlock] : []),
      {
        absolutePosition: { x: INSTITUTION_BLOCK.x, y: INSTITUTION_BLOCK.y },
        width: INSTITUTION_BLOCK.width,
        stack: institutionStack,
      },
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
