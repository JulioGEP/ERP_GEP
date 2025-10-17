import {
  getCertificateImageDataUrl,
  getPdfMakeInstance,
  pdfMakeReady,
  type CertificateImageKey
} from './pdfmake-initializer';

(function (global) {
  const TRANSPARENT_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NkYGD4DwABBAEAi5JBSwAAAABJRU5ErkJggg==';

  const LEFT_PANEL_TEXT_COLOR = '#ffffff';
  const LEFT_PANEL_MUTED_TEXT_COLOR = '#f5c9da';
  const BODY_TEXT_COLOR = '#3a405a';
  const TITLE_TEXT_COLOR = '#c1124f';
  const SECONDARY_TEXT_COLOR = '#5a617a';
  const FONT_SIZE_ADJUSTMENT = 2;
  const LINE_HEIGHT_REDUCTION = 0.5;
  const MIN_LINE_HEIGHT = 0.7;

  const PAGE_DIMENSIONS = {
    width: 841.89,
    height: 595.28
  };

  const PAGE_MARGINS = [60, 50, 70, 60] as const;
  const USABLE_WIDTH = PAGE_DIMENSIONS.width - PAGE_MARGINS[0] - PAGE_MARGINS[2];
  const COLUMN_GAP = 36;
  const LEFT_PANEL_WIDTH =
    Math.round(Math.max(240, USABLE_WIDTH * 0.55) * 100) / 100;
  const RIGHT_COLUMN_WIDTH =
    Math.round((USABLE_WIDTH - LEFT_PANEL_WIDTH - COLUMN_GAP) * 100) / 100;
  const RIGHT_COLUMN_X = PAGE_MARGINS[0] + LEFT_PANEL_WIDTH + COLUMN_GAP;
  const CONTENT_HEIGHT = PAGE_DIMENSIONS.height - PAGE_MARGINS[1] - PAGE_MARGINS[3];
  const RIGHT_COLUMN_HEADER_ANCHOR_Y = 260;
  const HEADER_RESERVED_HEIGHT = Math.max(
    0,
    RIGHT_COLUMN_HEADER_ANCHOR_Y - PAGE_MARGINS[1]
  );
  const SAFE_CONTENT_BOTTOM = PAGE_MARGINS[1] + CONTENT_HEIGHT - 8;

  type ImageDimensions = {
    width: number;
    height: number;
  };

  const REQUIRED_FONT_STYLES = ['normal', 'bold', 'italics', 'bolditalics'] as const;

  function isFontFullyRegistered(pdfMakeInstance, family) {
    if (!pdfMakeInstance || !family) {
      return false;
    }

    const fonts = pdfMakeInstance.fonts;
    const vfs = pdfMakeInstance.vfs;

    if (!fonts || !vfs) {
      return false;
    }

    const familyDefinition = fonts[family];

    if (!familyDefinition || typeof familyDefinition !== 'object') {
      return false;
    }

    return REQUIRED_FONT_STYLES.every((style) => {
      const fileName = familyDefinition[style];
      return typeof fileName === 'string' && fileName in vfs;
    });
  }

  const trainingTemplates = global.trainingTemplates || null;

  type CertificatePdfStudent = {
    nombre?: string;
    apellido?: string;
    dni?: string;
    documentType?: string;
  };

  type CertificatePdfDeal = {
    id?: string | null;
    sedeLabel?: string | null;
    organizationName?: string | null;
  };

  type CertificatePdfSession = {
    id?: string | null;
    nombre?: string | null;
    fechaInicioUtc?: string | null;
    fecha_inicio_utc?: string | null;
    formattedStartDate?: string | null;
    secondDateLabel?: string | null;
    fechaFinUtc?: string | null;
    location?: string | null;
    lugar?: string | null;
    productHours?: number | null;
  };

  type CertificatePdfProduct = {
    id?: string | null;
    name?: string | null;
    templateName?: string | null;
    hours?: number | null;
  };

  type CertificatePdfMetadata = {
    cliente?: string | null;
    trainer?: string | null;
    primaryDateLabel?: string | null;
    secondaryDateLabel?: string | null;
    locationLabel?: string | null;
    durationLabel?: string | null;
    trainingLabel?: string | null;
  };

  type CertificatePdfRow = {
    alumno?: CertificatePdfStudent;
    deal?: CertificatePdfDeal;
    session?: CertificatePdfSession;
    producto?: CertificatePdfProduct;
    metadata?: CertificatePdfMetadata;
    [key: string]: unknown;
  };

  function getStudentInfo(row: CertificatePdfRow | null | undefined): CertificatePdfStudent {
    if (row && row.alumno && typeof row.alumno === 'object') {
      return row.alumno;
    }
    if (row && typeof row === 'object') {
      const legacySurname =
        typeof row.apellido === 'string'
          ? row.apellido
          : typeof row.apellidos === 'string'
            ? row.apellidos
            : undefined;
      return {
        nombre: typeof row.nombre === 'string' ? row.nombre : undefined,
        apellido: legacySurname,
        dni: typeof row.dni === 'string' ? row.dni : undefined,
        documentType: typeof row.documentType === 'string' ? row.documentType : undefined,
      };
    }
    return {};
  }

  function getDealInfo(row: CertificatePdfRow | null | undefined): CertificatePdfDeal {
    if (row && row.deal && typeof row.deal === 'object') {
      return row.deal;
    }
    if (row && typeof row === 'object') {
      return {
        sedeLabel: typeof row.lugar === 'string' ? row.lugar : undefined,
        organizationName: typeof row.cliente === 'string' ? row.cliente : undefined,
      };
    }
    return {};
  }

  function getSessionInfo(row: CertificatePdfRow | null | undefined): CertificatePdfSession {
    if (row && row.session && typeof row.session === 'object') {
      return row.session;
    }
    if (row && typeof row === 'object') {
      return {
        fechaInicioUtc: typeof row.fecha === 'string' ? row.fecha : undefined,
        secondDateLabel: typeof row.segundaFecha === 'string' ? row.segundaFecha : undefined,
        location: typeof row.lugar === 'string' ? row.lugar : undefined,
      };
    }
    return {};
  }

  function getProductInfo(row: CertificatePdfRow | null | undefined): CertificatePdfProduct {
    if (row && row.producto && typeof row.producto === 'object') {
      return row.producto;
    }
    if (row && typeof row === 'object') {
      return {
        name: typeof row.formacion === 'string' ? row.formacion : undefined,
        templateName: typeof row.formacion === 'string' ? row.formacion : undefined,
        hours:
          typeof row.duracion === 'number'
            ? row.duracion
            : typeof row.horas === 'number'
              ? row.horas
              : undefined,
      };
    }
    return {};
  }

  function getMetadataInfo(row: CertificatePdfRow | null | undefined): CertificatePdfMetadata {
    if (row && row.metadata && typeof row.metadata === 'object') {
      return row.metadata;
    }
    if (row && typeof row === 'object') {
      return {
        cliente: typeof row.cliente === 'string' ? row.cliente : undefined,
        trainer: typeof row.irata === 'string' ? row.irata : undefined,
        primaryDateLabel: typeof row.fecha === 'string' ? row.fecha : undefined,
        secondaryDateLabel: typeof row.segundaFecha === 'string' ? row.segundaFecha : undefined,
        locationLabel: typeof row.lugar === 'string' ? row.lugar : undefined,
        durationLabel:
          typeof row.duracion === 'string'
            ? row.duracion
            : typeof row.horas === 'string'
              ? row.horas
              : undefined,
        trainingLabel: typeof row.formacion === 'string' ? row.formacion : undefined,
      };
    }
    return {};
  }

  function resolveTextValue(...values: Array<string | null | undefined>): string {
    for (const value of values) {
      const text = normaliseText(value);
      if (text) {
        return text;
      }
    }
    return '';
  }

  function getStudentName(row: CertificatePdfRow | null | undefined): string {
    const student = getStudentInfo(row);
    const name = normaliseText(student.nombre);
    if (name) {
      return name;
    }
    if (row && typeof row === 'object') {
      return normaliseText(row.nombre);
    }
    return '';
  }

  function getStudentSurname(row: CertificatePdfRow | null | undefined): string {
    const student = getStudentInfo(row);
    const surname = normaliseText(student.apellido);
    if (surname) {
      return surname;
    }
    if (row && typeof row === 'object') {
      const legacySurname =
        normaliseText(row.apellido) || normaliseText(row.apellidos);
      if (legacySurname) {
        return legacySurname;
      }
    }
    return '';
  }

  function getStudentDni(row: CertificatePdfRow | null | undefined): string {
    const student = getStudentInfo(row);
    const dni = normaliseText(student.dni);
    if (dni) {
      return dni;
    }
    if (row && typeof row === 'object') {
      return normaliseText(row.dni);
    }
    return '';
  }

  function getDocumentTypeValue(row: CertificatePdfRow | null | undefined): string {
    const student = getStudentInfo(row);
    const docType = normaliseText(student.documentType);
    if (docType) {
      return docType;
    }
    if (row && typeof row === 'object' && typeof row.documentType === 'string') {
      const legacyDoc = normaliseText(row.documentType);
      if (legacyDoc) {
        return legacyDoc;
      }
    }
    const dni = getStudentDni(row);
    if (dni) {
      return 'DNI';
    }
    return '';
  }

  function getPrimaryDateValue(row: CertificatePdfRow | null | undefined): string {
    const session = getSessionInfo(row);
    const metadata = getMetadataInfo(row);
    return resolveTextValue(
      session.fechaInicioUtc,
      session.fecha_inicio_utc,
      metadata.primaryDateLabel,
      session.formattedStartDate,
      row && typeof row === 'object' && typeof row.fecha === 'string' ? row.fecha : undefined
    );
  }

  function getSecondaryDateValue(row: CertificatePdfRow | null | undefined): string {
    const session = getSessionInfo(row);
    const metadata = getMetadataInfo(row);
    return resolveTextValue(
      session.secondDateLabel,
      metadata.secondaryDateLabel,
      session.fechaFinUtc,
      row && typeof row === 'object' && typeof row.segundaFecha === 'string'
        ? row.segundaFecha
        : undefined
    );
  }

  function getLocationValue(row: CertificatePdfRow | null | undefined): string {
    const session = getSessionInfo(row);
    const metadata = getMetadataInfo(row);
    const deal = getDealInfo(row);
    return resolveTextValue(
      metadata.locationLabel,
      session.location,
      session.lugar,
      deal.sedeLabel,
      row && typeof row === 'object' && typeof row.lugar === 'string' ? row.lugar : undefined
    );
  }

  function getDurationValue(row: CertificatePdfRow | null | undefined): string | number | null {
    const product = getProductInfo(row);
    if (typeof product.hours === 'number') {
      return product.hours;
    }
    const session = getSessionInfo(row);
    if (typeof session.productHours === 'number') {
      return session.productHours;
    }
    const metadata = getMetadataInfo(row);
    const metadataDuration = normaliseText(metadata.durationLabel);
    if (metadataDuration) {
      return metadataDuration;
    }
    if (row && typeof row === 'object') {
      if (typeof row.duracion === 'number') {
        return row.duracion;
      }
      const legacyDuration = normaliseText(row.duracion) || normaliseText(row.horas);
      if (legacyDuration) {
        return legacyDuration;
      }
    }
    return null;
  }

  function getTrainingTemplateKey(row: CertificatePdfRow | null | undefined): string {
    const product = getProductInfo(row);
    const metadata = getMetadataInfo(row);
    const candidate = resolveTextValue(
      product.templateName,
      metadata.trainingLabel,
      product.name,
      row && typeof row === 'object' && typeof row.formacion === 'string' ? row.formacion : undefined
    );
    return candidate;
  }

  function getTrainingNameValue(row: CertificatePdfRow | null | undefined): string {
    const product = getProductInfo(row);
    const metadata = getMetadataInfo(row);
    const value = resolveTextValue(
      metadata.trainingLabel,
      product.name,
      product.templateName,
      row && typeof row === 'object' && typeof row.formacion === 'string' ? row.formacion : undefined
    );
    return value;
  }

  function getTrainerValue(row: CertificatePdfRow | null | undefined): string {
    const metadata = getMetadataInfo(row);
    const trainer = normaliseText(metadata.trainer);
    if (trainer) {
      return trainer;
    }
    if (row && typeof row === 'object' && typeof row.irata === 'string') {
      return normaliseText(row.irata);
    }
    return '';
  }

  function adjustFontSize(size) {
    return typeof size === 'number' ? size + FONT_SIZE_ADJUSTMENT : size;
  }

  function adjustLineHeight(value) {
    if (typeof value !== 'number') {
      return value;
    }
    return Math.max(MIN_LINE_HEIGHT, value - LINE_HEIGHT_REDUCTION);
  }

  function buildTrainingDetailsContent(details) {
    if (!details) {
      return [];
    }

    const theoryItems = Array.isArray(details.theory) ? details.theory : [];
    const practiceItems = Array.isArray(details.practice) ? details.practice : [];
    const manualText = normaliseText(details.manual);
    const blocks: Array<Record<string, unknown>> = [];

    if (theoryItems.length) {
      blocks.push({
        stack: [
          { text: 'Módulos teóricos', style: 'sectionHeading' },
          {
            ul: theoryItems.map((item) => ({ text: item, style: 'theoryListItem' })),
            margin: [0, 4, 0, 0]
          }
        ],
        margin: [0, 0, 0, 10]
      });
    }

    if (practiceItems.length) {
      blocks.push({
        stack: [
          { text: 'Módulos prácticos', style: 'sectionHeading' },
          {
            ul: practiceItems.map((item) => ({ text: item, style: 'listItem' })),
            margin: [0, 4, 0, 0]
          }
        ],
        margin: [0, 0, 0, manualText ? 10 : 0]
      });
    }

    if (manualText) {
      blocks.push({
        stack: [
          { text: 'Manual de contenidos', style: 'sectionHeading' },
          { text: manualText, style: 'manualParagraph' }
        ],
        margin: [0, 0, 0, 0]
      });
    }

    return blocks;
  }

  async function getCachedAsset(key: CertificateImageKey) {
    await pdfMakeReady;
    const dataUrl = getCertificateImageDataUrl(key);
    if (dataUrl) {
      return dataUrl;
    }
    console.warn(`No se ha podido encontrar el recurso "${key}" en el VFS de pdfMake.`);
    return TRANSPARENT_PIXEL;
  }

  async function measureImageDimensions(dataUrl: string): Promise<ImageDimensions | null> {
    if (!dataUrl) {
      return null;
    }

    const GlobalImage = (global as typeof window | undefined)?.Image;
    if (!GlobalImage) {
      return null;
    }

    return new Promise((resolve) => {
      const img = new GlobalImage();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (!width || !height) {
          resolve(null);
          return;
        }

        resolve({ width, height });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function normaliseText(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  function buildFullName(row: CertificatePdfRow | null | undefined) {
    const name = getStudentName(row);
    const surname = getStudentSurname(row);
    const fullName = [name, surname].filter(Boolean).join(' ').trim();
    return fullName || 'Nombre del alumno/a';
  }

  function buildDocumentSentenceFragments(row: CertificatePdfRow | null | undefined) {
    const documentType = normaliseText(getDocumentTypeValue(row)).toUpperCase();
    const documentNumber = getStudentDni(row);

    if (!documentType && !documentNumber) {
      return [{ text: 'con documento de identidad' }];
    }

    if (!documentType) {
      return [
        { text: 'con documento ' },
        { text: documentNumber, bold: true }
      ];
    }

    if (!documentNumber) {
      return [{ text: `con ${documentType}` }];
    }

    return [
      { text: `con ${documentType} ` },
      { text: documentNumber, bold: true }
    ];
  }

  function buildDocumentSentence(row) {
    return buildDocumentSentenceFragments(row)
      .map((fragment) => (fragment && typeof fragment.text === 'string' ? fragment.text : ''))
      .join('');
  }

  function formatTrainingDate(value) {
    const normalised = normaliseText(value);
    if (!normalised) {
      return '________';
    }
    const parsed = parseDateValue(normalised);
    if (!parsed) {
      return normalised.replace(/[\/]/g, '-');
    }
    const formatter = new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    return formatter.format(parsed);
  }

  function parseDateValue(value) {
    const normalised = normaliseText(value);
    if (!normalised) {
      return null;
    }
    const isoMatch = normalised.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const slashMatch = normalised.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (slashMatch) {
      const [, rawDay, rawMonth, rawYear] = slashMatch;
      const day = Number(rawDay);
      const month = Number(rawMonth);
      const year = rawYear.length === 2 ? Number(`20${rawYear}`) : Number(rawYear);
      if (
        Number.isInteger(day) &&
        Number.isInteger(month) &&
        Number.isInteger(year) &&
        day > 0 &&
        day <= 31 &&
        month > 0 &&
        month <= 12
      ) {
        const parsed = new Date(year, month - 1, day);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
    }

    const parsed = new Date(normalised);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  function formatTrainingDateRange(primaryValue, secondaryValue) {
    const hasSecondary = normaliseText(secondaryValue) !== '';
    if (!hasSecondary) {
      return formatTrainingDate(primaryValue);
    }

    const hasPrimary = normaliseText(primaryValue) !== '';
    if (!hasPrimary) {
      return formatTrainingDate(secondaryValue);
    }

    const primaryDate = parseDateValue(primaryValue);
    const secondaryDate = parseDateValue(secondaryValue);

    if (primaryDate && secondaryDate) {
      const sameYear = primaryDate.getFullYear() === secondaryDate.getFullYear();
      if (sameYear) {
        const yearFormatter = new Intl.DateTimeFormat('es-ES', { year: 'numeric' });
        const yearLabel = yearFormatter.format(primaryDate);

        if (primaryDate.getMonth() === secondaryDate.getMonth()) {
          const dayFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric' });
          const monthFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long' });
          const firstDay = dayFormatter.format(primaryDate);
          const secondDay = dayFormatter.format(secondaryDate);
          const monthLabel = monthFormatter.format(primaryDate);
          return `${firstDay} y ${secondDay} de ${monthLabel} de ${yearLabel}`;
        }

        const dayMonthFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });
        const firstDayMonth = dayMonthFormatter.format(primaryDate);
        const secondDayMonth = dayMonthFormatter.format(secondaryDate);
        return `${firstDayMonth} y ${secondDayMonth} de ${yearLabel}`;
      }

      const fullFormatter = new Intl.DateTimeFormat('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      return `${fullFormatter.format(primaryDate)} y ${fullFormatter.format(secondaryDate)}`;
    }

    const formattedPrimary = formatTrainingDate(primaryValue);
    const formattedSecondary = formatTrainingDate(secondaryValue);

    if (formattedPrimary === '________') {
      return formattedSecondary;
    }
    if (formattedSecondary === '________') {
      return formattedPrimary;
    }

    return `${formattedPrimary} y ${formattedSecondary}`;
  }

  function formatDateAsDayMonthYear(value) {
    const parsedDate = parseDateValue(value);
    if (parsedDate) {
      const day = String(parsedDate.getDate()).padStart(2, '0');
      const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const year = parsedDate.getFullYear();
      return `${day}-${month}-${year}`;
    }

    const normalised = normaliseText(value);
    if (normalised) {
      const slashNormalised = normalised.replace(/[\/]/g, '-');
      const dashMatch = slashNormalised.match(/^(\d{1,4})-(\d{1,2})-(\d{2,4})$/);
      if (dashMatch) {
        const [_, first, second, third] = dashMatch;
        if (first.length === 4) {
          return `${third.padStart(2, '0')}-${second.padStart(2, '0')}-${first}`;
        }
        return `${first.padStart(2, '0')}-${second.padStart(2, '0')}-${third.padStart(4, '0')}`;
      }
      return slashNormalised;
    }

    return '____';
  }

  function formatLocation(value) {
    const normalised = normaliseText(value);
    return normalised ? normalised.toUpperCase() : '________';
  }

  function formatDuration(value) {
    if (value === undefined || value === null || value === '') {
      return '____';
    }
    const numberValue = Number(value);
    if (Number.isNaN(numberValue)) {
      return normaliseText(value);
    }
    return numberValue % 1 === 0 ? String(numberValue) : numberValue.toLocaleString('es-ES');
  }

  function formatTrainingName(value) {
    return normaliseText(value) || 'Nombre de la formación';
  }

  function resolveTrainingTitle(row: CertificatePdfRow | null | undefined) {
    const templateKey = getTrainingTemplateKey(row);
    if (templateKey && trainingTemplates && typeof trainingTemplates.getTrainingTitle === 'function') {
      const templateTitle = trainingTemplates.getTrainingTitle(templateKey);
      const normalised = normaliseText(templateTitle);
      if (normalised) {
        return normalised;
      }
    }

    const rawTitle = normaliseText(getTrainingNameValue(row));
    return rawTitle || 'Formación sin título';
  }

  function normaliseIsoDate(value) {
    const parsed = parseDateValue(value);
    if (!parsed) {
      return '';
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateForFileName(value) {
    const iso = normaliseIsoDate(value);
    if (iso) {
      const [year, month, day] = iso.split('-');
      return `${day}-${month}-${year}`;
    }

    const fallback = normaliseText(value);
    if (fallback) {
      return fallback.replace(/[\\/]+/g, '-').replace(/\s+/g, ' ');
    }

    return 'Fecha sin definir';
  }

  function normalizeForAscii(value) {
    const text = normaliseText(value);
    if (!text) {
      return '';
    }
    const normalized = typeof text.normalize === 'function' ? text.normalize('NFD') : text;
    return normalized
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^0-9a-zA-Z]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  }

  function buildFileName(row: CertificatePdfRow | null | undefined) {
    const dniComponent = normalizeForAscii(getStudentDni(row)) || 'SIN_DNI';
    const surnameComponent = normalizeForAscii(getStudentSurname(row)) || 'SIN_APELLIDOS';
    const productComponent = normalizeForAscii(resolveTrainingTitle(row)) || 'SIN_FORMACION';
    const parts = ['CERTIFICADO', dniComponent, surnameComponent, productComponent];
    return `${parts.join('_')}.pdf`;
  }

  function buildDocStyles() {
    return {
      bodyText: {
        fontSize: adjustFontSize(11.5),
        lineHeight: adjustLineHeight(1.65),
        color: BODY_TEXT_COLOR,
        margin: [0, 0, 0, 8]
      },
      introText: {
        fontSize: adjustFontSize(10),
        lineHeight: adjustLineHeight(1.4),
        color: SECONDARY_TEXT_COLOR,
        margin: [0, 0, 0, 8]
      },
      certificateTitle: {
        fontSize: adjustFontSize(40),
        bold: true,
        color: TITLE_TEXT_COLOR,
        characterSpacing: 0.5,
        alignment: 'center',
        margin: [0, 0, 0, 14]
      },
      highlighted: {
        fontSize: adjustFontSize(13),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 8, 0, 8]
      },
      highlightName: {
        fontSize: adjustFontSize(17),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 0, 0, 6]
      },
      trainingName: {
        fontSize: adjustFontSize(14),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 6, 0, 18]
      },
      contentSectionTitle: {
        fontSize: adjustFontSize(12),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 18, 0, 10],
        letterSpacing: 1
      },
      sectionHeading: {
        fontSize: adjustFontSize(11),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 0, 0, 6]
      },
      listItem: {
        fontSize: adjustFontSize(9),
        lineHeight: adjustLineHeight(1.3),
        color: BODY_TEXT_COLOR,
        margin: [0, 0, 0, 4]
      },
      theoryListItem: {
        fontSize: adjustFontSize(9),
        lineHeight: adjustLineHeight(1.3),
        color: BODY_TEXT_COLOR,
        margin: [0, 0, 0, 4]
      },
      manualParagraph: {
        fontSize: adjustFontSize(9),
        lineHeight: adjustLineHeight(1.35),
        color: BODY_TEXT_COLOR,
        margin: [0, 4, 0, 0]
      },
      leftPanelTitle: {
        fontSize: adjustFontSize(20),
        bold: true,
        color: LEFT_PANEL_TEXT_COLOR,
        lineHeight: adjustLineHeight(1.15)
      },
      leftPanelSubtitle: {
        fontSize: adjustFontSize(9),
        color: LEFT_PANEL_MUTED_TEXT_COLOR,
        lineHeight: adjustLineHeight(1.3)
      },
      leftPanelHeading: {
        fontSize: adjustFontSize(10),
        bold: true,
        color: LEFT_PANEL_TEXT_COLOR,
        margin: [0, 16, 0, 6],
        letterSpacing: 1
      },
      leftPanelSummaryLabel: {
        fontSize: adjustFontSize(8.5),
        bold: true,
        color: LEFT_PANEL_MUTED_TEXT_COLOR
      },
      leftPanelSummaryValue: {
        fontSize: adjustFontSize(11),
        color: LEFT_PANEL_TEXT_COLOR
      },
      leftPanelFooter: {
        fontSize: adjustFontSize(8.5),
        color: LEFT_PANEL_MUTED_TEXT_COLOR,
        margin: [0, 24, 0, 0]
      },
      metadataText: {
        fontSize: adjustFontSize(9.5),
        color: SECONDARY_TEXT_COLOR,
        margin: [0, 8, 0, 0]
      }
    };
  }

  async function buildDocDefinition(row: CertificatePdfRow | null | undefined = {}) {
    await pdfMakeReady;
    const pdfMakeInstance = await getPdfMakeInstance();
    const preferredFontFamily = isFontFullyRegistered(pdfMakeInstance, 'Poppins')
      ? 'Poppins'
      : 'Roboto';

    const [
      backgroundImage,
      leftSidebarImage,
      footerImage,
      logoImage
    ] = await Promise.all([
      getCachedAsset('background'),
      getCachedAsset('leftSidebar'),
      getCachedAsset('footer'),
      getCachedAsset('logo')
    ]);

    const [
      backgroundImageDimensions,
      leftSidebarDimensions,
      footerImageDimensions
    ] = await Promise.all([
      measureImageDimensions(backgroundImage),
      measureImageDimensions(leftSidebarImage),
      measureImageDimensions(footerImage)
    ]);

    const pageMargins = [...PAGE_MARGINS];
    const totalContentWidth = Math.max(0, USABLE_WIDTH);
    const leftColumnWidth = LEFT_PANEL_WIDTH;
    const rightColumnWidth = Math.max(0, RIGHT_COLUMN_WIDTH);
    const columnGap = COLUMN_GAP;
    const rightColumnX = RIGHT_COLUMN_X;
    const contentHeight = Math.max(0, CONTENT_HEIGHT);

    const fullName = buildFullName(row);
    const formattedFullName = normaliseText(fullName).toUpperCase() || fullName;
    const trainingDate = formatTrainingDateRange(
      getPrimaryDateValue(row),
      getSecondaryDateValue(row)
    );
    const location = formatLocation(getLocationValue(row));
    const duration = formatDuration(getDurationValue(row));
    const durationLabel = duration === '____' ? '____ horas' : `${duration} horas`;
    const trainingTitle = resolveTrainingTitle(row);
    const trainingNameRaw = formatTrainingName(trainingTitle);
    const trainingNameDisplay = normaliseText(trainingNameRaw).toUpperCase() ||
      trainingNameRaw.toUpperCase();
    const templateKey = getTrainingTemplateKey(row);
    const trainingDetails =
      templateKey && trainingTemplates
        ? trainingTemplates.getTrainingDetails(templateKey)
        : null;
    const trainer = normaliseText(getTrainerValue(row));
    const dealInfo = getDealInfo(row);
    const organizationName = normaliseText(dealInfo.organizationName);
    const sedeLabel = normaliseText(dealInfo.sedeLabel);

    const documentTypeLabel = normaliseText(getDocumentTypeValue(row)).toUpperCase();
    const documentNumber = normaliseText(getStudentDni(row));
    const identityLabelParts = [];
    if (documentTypeLabel) {
      identityLabelParts.push(`con ${documentTypeLabel}`);
    } else {
      identityLabelParts.push('con DNI');
    }
    identityLabelParts.push(documentNumber || '________');
    const identityLine = identityLabelParts.join(' ');

    const formattedPrimaryDate = formatDateAsDayMonthYear(getPrimaryDateValue(row));
    const readableDate = trainingDate === '________' ? '' : trainingDate;
    const readableLocation = location === '________' ? formatLocation(sedeLabel) : location;
    const readableDuration = duration === '____' ? '' : `${duration} horas`;

    const formattedLocationLabel = (() => {
      const rawLocation = normaliseText(readableLocation);
      return rawLocation ? rawLocation.toUpperCase() : '________';
    })();

    const rightColumnHeaderStack = [
      {
        text: 'Sr. Lluís Vicent Pérez,\nDirector de la escuela GEPCO Formación\nexpide el presente:',
        style: 'introText',
        alignment: 'left',
        margin: [0, 0, 0, 8],
        preserveLeadingSpaces: true
      },
      { text: 'CERTIFICADO', style: 'certificateTitle' },
      {
        text: `A nombre del alumno/a ${formattedFullName}`,
        style: 'highlightName'
      },
      {
        text: identityLine,
        style: 'bodyText',
        alignment: 'left',
        margin: [0, 0, 0, 2]
      },
      {
        text: `quien en fecha ${formattedPrimaryDate} y en ${formattedLocationLabel}`,
        style: 'bodyText',
        alignment: 'left',
        margin: [0, 0, 0, 2]
      },
      {
        text: `ha superado, con una duración total de ${durationLabel}, la siguiente formación:`,
        style: 'bodyText',
        alignment: 'left',
        margin: [0, 0, 0, 10]
      },
      {
        text: `CURSO: ${trainingNameDisplay}`,
        style: 'trainingName',
        alignment: 'left'
      }
    ];

    const metadataLines: string[] = [];
    if (organizationName) {
      metadataLines.push(`Organizado para ${organizationName}.`);
    }
    if (trainer) {
      metadataLines.push(`Impartido por ${trainer}.`);
    }

    metadataLines.forEach((line) => {
      rightColumnHeaderStack.push({ text: line, style: 'metadataText' });
    });

    const rightColumnBodyStack: Array<Record<string, unknown>> = [];

    const trainingDetailsContent = buildTrainingDetailsContent(trainingDetails);

    if (trainingDetailsContent.length) {
      rightColumnBodyStack.push({
        text: 'Contenidos de la formación',
        style: 'contentSectionTitle',
        margin: [0, 0, 0, 0]
      });
      rightColumnBodyStack.push(...trainingDetailsContent);
    }

    const headerTableWidth = rightColumnWidth > 0 ? rightColumnWidth : totalContentWidth;
    const rightColumnStack: Array<Record<string, unknown>> = [];
    const headerTable: Record<string, unknown> = {
      table: {
        widths: [headerTableWidth],
        body: [[{ stack: rightColumnHeaderStack, border: [false, false, false, false] }]]
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0
      }
    };

    if (HEADER_RESERVED_HEIGHT > 0) {
      headerTable.heights = [HEADER_RESERVED_HEIGHT];
    }

    rightColumnStack.push(headerTable);

    if (rightColumnBodyStack.length) {
      rightColumnStack.push(...rightColumnBodyStack);
    }

    const summaryEntries = [
      { label: 'Fecha', value: readableDate },
      { label: 'Duración', value: readableDuration },
      { label: 'Lugar', value: readableLocation },
      { label: 'Cliente', value: organizationName },
      { label: 'Formador/a', value: trainer }
    ].filter((entry) => entry.value);

    const leftColumnStack = [
      { text: 'GEPCO Formación', style: 'leftPanelTitle' },
      {
        text: 'Escuela acreditada en seguridad y emergencias',
        style: 'leftPanelSubtitle',
        margin: [0, 6, 0, 0]
      }
    ];

    if (summaryEntries.length) {
      leftColumnStack.push({ text: 'Detalles de la formación', style: 'leftPanelHeading' });
      summaryEntries.forEach((entry) => {
        leftColumnStack.push({
          columns: [
            { text: entry.label.toUpperCase(), style: 'leftPanelSummaryLabel', width: 'auto' },
            { text: entry.value, style: 'leftPanelSummaryValue', width: '*' }
          ],
          columnGap: 6,
          margin: [0, 4, 0, 0]
        });
      });
    }

    if (logoImage) {
      leftColumnStack.push({
        image: logoImage,
        width: Math.min(leftColumnWidth * 0.6, 180),
        margin: [0, 40, 0, 12]
      });
    }

    leftColumnStack.push({ text: 'www.gepcoformacion.com', style: 'leftPanelFooter' });
    leftColumnStack.push({
      text: 'ERP Group',
      style: 'leftPanelSubtitle',
      margin: [0, 6, 0, 0]
    });

    const decorativeElements: Array<Record<string, unknown>> = [];
    const overlayElements: Array<Record<string, unknown>> = [];

    if (rightColumnWidth > 0 && backgroundImage) {
      let backgroundHeight = contentHeight;

      if (
        backgroundImageDimensions &&
        backgroundImageDimensions.width > 0 &&
        backgroundImageDimensions.height > 0
      ) {
        const scaleToWidth = rightColumnWidth / backgroundImageDimensions.width;
        backgroundHeight = backgroundImageDimensions.height * scaleToWidth;
      }

      decorativeElements.push({
        image: backgroundImage,
        absolutePosition: { x: rightColumnX, y: pageMargins[1] },
        width: rightColumnWidth,
        height: backgroundHeight,
        opacity: 1
      });
    }

    if (leftSidebarImage) {
      const targetSidebarWidth = Math.min(Math.max(70, Math.min(80, leftColumnWidth)), leftColumnWidth);

      if (targetSidebarWidth > 0) {
        let sidebarWidth = targetSidebarWidth;
        let sidebarHeight = contentHeight;

        if (
          leftSidebarDimensions &&
          leftSidebarDimensions.width > 0 &&
          leftSidebarDimensions.height > 0
        ) {
          const widthScale = sidebarWidth / leftSidebarDimensions.width;
          sidebarHeight = leftSidebarDimensions.height * widthScale;

          if (sidebarHeight > contentHeight) {
            const heightScale = contentHeight / leftSidebarDimensions.height;
            sidebarWidth = leftSidebarDimensions.width * heightScale;
            sidebarHeight = contentHeight;
          }
        }

        decorativeElements.push({
          image: leftSidebarImage,
          absolutePosition: { x: pageMargins[0], y: pageMargins[1] },
          width: sidebarWidth,
          height: sidebarHeight,
          opacity: 1
        });
      }
    }

    let footerReservedHeight = 0;
    let contentLimitY = SAFE_CONTENT_BOTTOM;

    if (footerImage && totalContentWidth > 0) {
      const footerWidth = totalContentWidth;
      let footerHeight = Math.min(140, contentHeight * 0.25);

      if (footerImageDimensions && footerImageDimensions.width > 0) {
        const footerScale = footerWidth / footerImageDimensions.width;
        footerHeight = footerImageDimensions.height * footerScale;
      }

      contentLimitY = SAFE_CONTENT_BOTTOM - footerHeight;
      footerReservedHeight = Math.max(0, pageMargins[1] + contentHeight - contentLimitY);
      const footerTop = pageMargins[1] + contentHeight - footerHeight;

      overlayElements.push({
        image: footerImage,
        absolutePosition: {
          x: pageMargins[0],
          y: footerTop
        },
        width: footerWidth,
        height: footerHeight,
        opacity: 1
      });
    }

    const docDefinition = {
      pageOrientation: 'landscape',
      pageSize: 'A4',
      pageMargins,
      background: null,
      content: [
        ...decorativeElements,
        {
          columns: [
            {
              width: leftColumnWidth,
              stack: leftColumnStack
            },
            {
              width: rightColumnWidth,
              stack: rightColumnStack
            }
          ],
          columnGap,
          margin: [0, 0, 0, footerReservedHeight]
        },
        ...overlayElements
      ],
      styles: buildDocStyles(),
      defaultStyle: {
        fontSize: adjustFontSize(10),
        lineHeight: adjustLineHeight(1.45),
        color: BODY_TEXT_COLOR,
        font: preferredFontFamily
      },
      info: {
        title: `Certificado - ${fullName}`,
        author: 'GEPCO Formación',
        subject: trainingNameRaw
      }
    };

    return docDefinition;
  }

  function triggerDownload(blob, fileName) {
    if (typeof Blob !== 'undefined' && !(blob instanceof Blob)) {
      throw new Error('No se ha podido generar el archivo PDF.');
    }

    const { document: doc, URL: urlApi, navigator } = global;

    if (!blob) {
      throw new Error('El certificado generado está vacío.');
    }

    if (navigator && typeof navigator.msSaveOrOpenBlob === 'function') {
      navigator.msSaveOrOpenBlob(blob, fileName);
      return;
    }

    if (!doc || !urlApi || typeof urlApi.createObjectURL !== 'function') {
      throw new Error('El navegador no soporta la descarga automática de archivos.');
    }

    const downloadUrl = urlApi.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);

    setTimeout(() => {
      urlApi.revokeObjectURL(downloadUrl);
    }, 0);
  }

  async function generateCertificate(
    row: CertificatePdfRow | null | undefined,
    options: { download?: boolean } = {}
  ) {
    await pdfMakeReady;
    const pdfMakeInstance = await getPdfMakeInstance();

    if (!pdfMakeInstance || typeof pdfMakeInstance.createPdf !== 'function') {
      throw new Error('pdfMake no está disponible.');
    }
    const docDefinition = await buildDocDefinition(row || {});
    const fileName = buildFileName(row || {});
    const downloadEnabled = Object.prototype.hasOwnProperty.call(options || {}, 'download')
      ? Boolean(options.download)
      : true;

    return new Promise((resolve, reject) => {
      let pdfDocument;
      try {
        pdfDocument = pdfMakeInstance.createPdf(docDefinition);
      } catch (error) {
        reject(error);
        return;
      }

      try {
        pdfDocument.getBlob((blob) => {
          try {
            if (downloadEnabled) {
              triggerDownload(blob, fileName);
            }
            resolve({ fileName, blob });
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  global.certificatePdf = {
    generate: generateCertificate,
    buildDocDefinition,
    buildFileName,
    resolveTrainingTitle,
    formatDateForFileName
  };
})(window);
