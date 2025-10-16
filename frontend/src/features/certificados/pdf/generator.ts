import type { TDocumentDefinitions, Content, StyleDictionary } from 'pdfmake/interfaces';
import { getCertificateImageDataUrl, getPdfMakeInstance } from '../lib/pdf/pdfmake-initializer';

export interface CertificateStudentData {
  nombre: string;
  apellido: string;
  dni: string;
}

export interface CertificateSessionData {
  fecha_inicio_utc: string;
}

export interface CertificateDealData {
  sede_labels: string;
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
}

export type CertificateTemplateKey = 'CERT-PAUX-EI' | 'CERT-PACK' | 'CERT-GENERICO';

const DEFAULT_CERTIFICATE_TEMPLATE_KEY: CertificateTemplateKey = 'CERT-GENERICO';

type CertificateTemplateConfig = {
  key: CertificateTemplateKey;
  title?: string;
  backgroundKey?: 'background';
  sidebarKey?: 'leftSidebar';
  footerKey?: 'footer';
  logoKey?: 'logo';
  styles?: StyleDictionary;
};

const CERTIFICATE_TEMPLATE_RULES: { template: CertificateTemplateKey; keywords: string[] }[] = [
  { template: 'CERT-PAUX-EI', keywords: ['paux', 'auxiliar', 'educación infantil', 'educacion infantil'] },
  { template: 'CERT-PACK', keywords: ['pack', 'combo', 'paquete'] },
];

const CERTIFICATE_TEMPLATES: Record<CertificateTemplateKey, CertificateTemplateConfig> = {
  'CERT-PAUX-EI': {
    key: 'CERT-PAUX-EI',
    title: 'CERTIFICADO',
    backgroundKey: 'background',
    sidebarKey: 'leftSidebar',
    footerKey: 'footer',
    logoKey: 'logo',
  },
  'CERT-PACK': {
    key: 'CERT-PACK',
    title: 'CERTIFICADO',
    backgroundKey: 'background',
    sidebarKey: 'leftSidebar',
    footerKey: 'footer',
    logoKey: 'logo',
  },
  'CERT-GENERICO': {
    key: 'CERT-GENERICO',
    title: 'CERTIFICADO',
    backgroundKey: 'background',
    sidebarKey: 'leftSidebar',
    footerKey: 'footer',
    logoKey: 'logo',
  },
};

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
  Object.keys(CERTIFICATE_TEMPLATES) as CertificateTemplateKey[]
).map((key) => ({
  key,
  label: CERTIFICATE_TEMPLATE_LABELS[key],
}));

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

  if (!deal || !hasText(deal.sede_labels)) {
    throw new Error('Falta la sede para generar el certificado.');
  }

  if (!producto || !isPositiveNumber(producto.hours) || !hasText(producto.name)) {
    throw new Error('Faltan datos de la formación para generar el certificado.');
  }
}

function normaliseText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function resolveCertificateTemplateKey(productName: string): CertificateTemplateKey {
  const normalisedName = normaliseText(productName);

  const matchingRule = CERTIFICATE_TEMPLATE_RULES.find(({ keywords }) =>
    keywords.some((keyword) => normalisedName.includes(keyword))
  );

  return matchingRule?.template ?? DEFAULT_CERTIFICATE_TEMPLATE_KEY;
}

export function resolveCertificateTemplate(productName: string): CertificateTemplateConfig {
  const templateKey = resolveCertificateTemplateKey(productName);
  return CERTIFICATE_TEMPLATES[templateKey];
}

function formatDateLabel(dateValue: string): string {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function buildCertificateContent(data: CertificateGenerationData, template: CertificateTemplateConfig): Content {
  const formattedDate = formatDateLabel(data.sesion.fecha_inicio_utc);

  return {
    stack: [
      {
        text: 'Sr. Lluís Vicent Pérez,',
        style: 'body',
      },
      {
        text: 'Director de la escuela GEPCO Formación',
        style: 'body',
      },
      {
        text: 'expide el presente:',
        style: 'body',
        margin: [0, 0, 0, 12],
      },
      {
        text: template.title ?? 'CERTIFICADO',
        style: 'certificateTitle',
        margin: [0, 0, 0, 12],
      },
      {
        text: `A nombre del alumno/a ${data.alumno.nombre} ${data.alumno.apellido}`,
        style: 'body',
      },
      {
        text: `con ${data.alumno.dni}, quien en fecha ${formattedDate} y en ${data.deal.sede_labels}`,
        style: 'body',
      },
      {
        text: `ha superado, con una duración total de ${data.producto.hours} horas, la formación de:`,
        style: 'body',
        margin: [0, 0, 0, 12],
      },
      {
        text: data.producto.name,
        style: 'trainingName',
      },
    ],
    alignment: 'center',
    margin: [60, 180, 60, 0],
  };
}

function buildCertificateStyles(template: CertificateTemplateConfig): StyleDictionary {
  return {
    body: {
      font: 'Poppins',
      fontSize: 14,
      lineHeight: 1.3,
      color: '#1F1F1F',
    },
    certificateTitle: {
      font: 'Poppins',
      bold: true,
      fontSize: 34,
      lineHeight: 1.2,
      color: '#1F1F1F',
    },
    trainingName: {
      font: 'Poppins',
      bold: true,
      fontSize: 24,
      color: '#1F1F1F',
    },
    ...(template.styles ?? {}),
  };
}

function buildBackgroundLayers(template: CertificateTemplateConfig): NonNullable<TDocumentDefinitions['background']> {
  return (currentPage, pageSize) => {
    const layers: Content[] = [];

    if (template.backgroundKey) {
      const background = getCertificateImageDataUrl(template.backgroundKey);
      if (background) {
        layers.push({
          image: background,
          width: pageSize.width,
          absolutePosition: { x: 0, y: 0 },
        });
      }
    }

    if (template.sidebarKey) {
      const sidebar = getCertificateImageDataUrl(template.sidebarKey);
      if (sidebar) {
        layers.push({
          image: sidebar,
          height: pageSize.height,
          absolutePosition: { x: 0, y: 0 },
        });
      }
    }

    if (template.logoKey) {
      const logo = getCertificateImageDataUrl(template.logoKey);
      if (logo) {
        layers.push({
          image: logo,
          width: 180,
          absolutePosition: { x: pageSize.width - 220, y: 40 },
        });
      }
    }

    if (template.footerKey) {
      const footer = getCertificateImageDataUrl(template.footerKey);
      if (footer) {
        layers.push({
          image: footer,
          width: pageSize.width,
          absolutePosition: { x: 0, y: pageSize.height - 120 },
        });
      }
    }

    return layers;
  };
}

function createDocumentDefinition(data: CertificateGenerationData, template: CertificateTemplateConfig): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    info: {
      title: `Certificado - ${data.alumno.nombre} ${data.alumno.apellido}`,
      author: 'GEPCO Formación',
      subject: template.key,
    },
    defaultStyle: {
      font: 'Poppins',
      fontSize: 12,
      color: '#1F1F1F',
    },
    styles: buildCertificateStyles(template),
    background: buildBackgroundLayers(template),
    content: [buildCertificateContent(data, template)],
    pageMargins: [40, 40, 40, 40],
  };
}

const PREVIEW_SAMPLE_DATA: CertificateGenerationData = {
  alumno: {
    nombre: 'Nombre',
    apellido: 'Apellido',
    dni: '12345678A',
  },
  sesion: {
    fecha_inicio_utc: '2024-01-15',
  },
  deal: {
    sede_labels: 'Valencia',
  },
  producto: {
    name: 'Curso de ejemplo',
    hours: 20,
  },
};

export async function generateCertificatePDF(
  data: CertificateGenerationData,
  options?: { templateKey?: CertificateTemplateKey },
): Promise<Blob> {
  assertCertificateData(data);

  const pdfMakeInstance = await getPdfMakeInstance();
  const templateKey = options?.templateKey ?? resolveCertificateTemplateKey(data.producto.name);
  const template = CERTIFICATE_TEMPLATES[templateKey] ?? CERTIFICATE_TEMPLATES[DEFAULT_CERTIFICATE_TEMPLATE_KEY];
  const docDefinition = createDocumentDefinition(data, template);

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
  const template =
    CERTIFICATE_TEMPLATES[templateKey] ?? CERTIFICATE_TEMPLATES[DEFAULT_CERTIFICATE_TEMPLATE_KEY];
  const docDefinition = createDocumentDefinition(PREVIEW_SAMPLE_DATA, template);

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
