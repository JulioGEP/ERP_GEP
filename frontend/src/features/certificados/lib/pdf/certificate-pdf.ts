import {
  getCertificateImageDataUrl,
  getPdfMakeInstance,
  pdfMakeReady,
  type CertificateImageKey
} from './pdfmake-initializer';

(function (global) {
  const TRANSPARENT_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12NkYGD4DwABBAEAi5JBSwAAAABJRU5ErkJggg==';

  const LEFT_PANEL_RATIO = 0.36;
  const LEFT_PANEL_TEXT_COLOR = '#ffffff';
  const LEFT_PANEL_MUTED_TEXT_COLOR = '#f5c9da';
  const BODY_TEXT_COLOR = '#3a405a';
  const TITLE_TEXT_COLOR = '#c1124f';
  const PRODUCT_TITLE_COLOR = '#ff0000';
  const SECONDARY_TEXT_COLOR = '#5a617a';
  const FONT_SIZE_ADJUSTMENT = 2;
  const LINE_HEIGHT_REDUCTION = 0.5;
  const MIN_LINE_HEIGHT = 0.7;
  const PRACTICE_COLUMN_SHIFT_RATIO = 0;
  const PRACTICE_COLUMN_SHIFT_MAX = 2;
  const THEORY_COLUMN_ADDITIONAL_RIGHT_MARGIN = 2;
  const TRAINING_CONTENT_MIN_WIDTH = 320;
  const TRAINING_CONTENT_MIN_COLUMN_WIDTH = 150;
  const TRAINING_CONTENT_COLUMN_GAP = 18;
  const PRACTICE_BULLET_LEFT_OFFSET = 20;
  const FULL_BLEED_VERTICAL_BLEED = 1;
  const LEFT_SIDEBAR_BASE_SCALE = 1;
  const LEFT_SIDEBAR_MAX_WIDTH = 80;
  const THEORY_CONTENT_LEFT_SHIFT = 15;
  const FOOTER_SCALE_MULTIPLIER = 0.95;

  const PAGE_DIMENSIONS = {
    width: 841.89,
    height: 595.28
  };

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

  function buildTrainingDetailsContent(details, options = {}) {
    if (!details) {
      return [];
    }

    const theoryItems = Array.isArray(details.theory) ? details.theory : [];
    const practiceItems = Array.isArray(details.practice) ? details.practice : [];
    const columns = [];
    const baseColumnGap =
      typeof options.columnGap === 'number' && options.columnGap >= 0
        ? options.columnGap
        : TRAINING_CONTENT_COLUMN_GAP;

    if (theoryItems.length) {
      columns.push({
        stack: [
          { text: 'Parte teórica', style: 'sectionHeading' },
          {
            ul: theoryItems.map((item) => ({ text: item, style: 'theoryListItem' })),
            margin: [0, 2, 0, 0]
          }
        ],
        margin:
          THEORY_COLUMN_ADDITIONAL_RIGHT_MARGIN > 0
            ? [0, 0, THEORY_COLUMN_ADDITIONAL_RIGHT_MARGIN, 0]
            : [0, 0, 0, 0]
      });
    }

    if (practiceItems.length) {
      const practiceListBody = practiceItems.map((item) => [
        {
          text: '\u2022',
          style: 'listItem',
          alignment: 'right',
          margin: [0, 0, 6, 4]
        },
        {
          text: `${item}\n`,
          style: 'listItem',
          margin: [0, 0, 0, 4]
        }
      ]);

      columns.push({
        stack: [
          { text: 'Parte práctica', style: 'sectionHeading' },
          {
            table: {
              widths: [PRACTICE_BULLET_LEFT_OFFSET, '*'],
              body: practiceListBody
            },
            layout: 'noBorders',
            margin: [-PRACTICE_BULLET_LEFT_OFFSET, 2, 0, 0]
          }
        ],
        margin: [0, 0, 0, 0],
        isPractice: true
      });
    }

    if (!columns.length) {
      return [];
    }

    const hasPracticeColumn = columns.some((column) => column.isPractice);
    const hasNonPracticeColumn = columns.some((column) => !column.isPractice);
    const effectiveColumnGap =
      hasPracticeColumn && hasNonPracticeColumn
        ? Math.max(baseColumnGap, PRACTICE_BULLET_LEFT_OFFSET + 2)
        : baseColumnGap;

    const totalAvailableWidth =
      typeof options.totalAvailableWidth === 'number' && options.totalAvailableWidth > 0
        ? options.totalAvailableWidth
        : null;

    let boundingWidth =
      typeof options.boundingWidth === 'number' && options.boundingWidth > 0
        ? options.boundingWidth
        : null;

    if (boundingWidth !== null && totalAvailableWidth !== null) {
      boundingWidth = Math.min(boundingWidth, totalAvailableWidth);
    }

    if (boundingWidth === null) {
      boundingWidth = totalAvailableWidth || TRAINING_CONTENT_MIN_WIDTH;
    }

    const minimumBoundingWidth = (() => {
      const gapWidth = effectiveColumnGap * Math.max(columns.length - 1, 0);
      const requiredWidthForColumns =
        columns.length * TRAINING_CONTENT_MIN_COLUMN_WIDTH + gapWidth;
      const minWidthConstraint =
        totalAvailableWidth !== null
          ? Math.min(TRAINING_CONTENT_MIN_WIDTH, totalAvailableWidth)
          : TRAINING_CONTENT_MIN_WIDTH;
      const combinedMinimum = Math.max(requiredWidthForColumns, minWidthConstraint);
      return totalAvailableWidth !== null
        ? Math.min(combinedMinimum, totalAvailableWidth)
        : combinedMinimum;
    })();

    const effectiveBoundingWidth = Math.max(boundingWidth, minimumBoundingWidth);
    const totalGap = effectiveColumnGap * Math.max(columns.length - 1, 0);
    const rawColumnWidth =
      columns.length > 0
        ? (effectiveBoundingWidth - totalGap) / columns.length
        : effectiveBoundingWidth;
    const effectiveColumnWidth = Math.max(0, rawColumnWidth);

    const practiceColumnShift =
      typeof options.practiceColumnShift === 'number' && options.practiceColumnShift > 0
        ? options.practiceColumnShift
        : 0;

    const normalizedPracticeShift =
      columns.length > 1
        ? Math.min(
            practiceColumnShift,
            effectiveColumnGap * 0.5,
            effectiveColumnWidth * 0.1,
            PRACTICE_COLUMN_SHIFT_MAX
          )
        : 0;

    const sizedColumns = columns.map((column) => {
      const { isPractice, ...definition } = column;
      const sizedColumn = {
        ...definition,
        width: effectiveColumnWidth
      };
      if (isPractice) {
        sizedColumn.margin = normalizedPracticeShift
          ? [normalizedPracticeShift, 0, 0, 0]
          : [0, 0, 0, 0];
      }
      return sizedColumn;
    });

    return [
      {
        table: {
          widths: [effectiveBoundingWidth],
          body: [
            [
              {
                columns: sizedColumns,
                columnGap: effectiveColumnGap,
                margin: [0, 0, 0, 0]
              }
            ]
          ]
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0
        },
        margin: [-THEORY_CONTENT_LEFT_SHIFT, 4, 0, 12]
      }
    ];
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
    const parsed = new Date(normalised);
    if (Number.isNaN(parsed.getTime())) {
      return normalised;
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
      return normalised;
    }

    return '____';
  }

  function formatLocation(value) {
    return normaliseText(value) || '________';
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
    const text = normaliseText(value);
    if (!text) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return parsed.toISOString().split('T')[0];
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
        color: '#000000',
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
        fontSize: adjustFontSize(23),
        bold: true,
        color: PRODUCT_TITLE_COLOR,
        margin: [0, 0, 0, 0]
      },
      contentSectionTitle: {
        fontSize: adjustFontSize(12),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 18, 0, 10],
        letterSpacing: 1
      },
      sectionHeading: {
        fontSize: adjustFontSize(9),
        bold: true,
        color: TITLE_TEXT_COLOR,
        margin: [0, 0, 0, 6]
      },
      listItem: {
        fontSize: adjustFontSize(7),
        lineHeight: adjustLineHeight(1.3),
        color: BODY_TEXT_COLOR,
        margin: [0, 0, 0, 4]
      },
      theoryListItem: {
        fontSize: adjustFontSize(7),
        lineHeight: adjustLineHeight(1.3),
        color: BODY_TEXT_COLOR,
        margin: [0, 0, 0, 4]
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
      rawBackgroundImage,
      rawLeftSidebarImage,
      rawFooterImage,
      logoImage
    ] = await Promise.all([
      getCachedAsset('background'),
      getCachedAsset('leftSidebar'),
      getCachedAsset('footer'),
      getCachedAsset('logo')
    ]);

    const backgroundImage = rawBackgroundImage === TRANSPARENT_PIXEL ? null : rawBackgroundImage;
    const leftSidebarImage = rawLeftSidebarImage === TRANSPARENT_PIXEL ? null : rawLeftSidebarImage;
    const footerImage = rawFooterImage === TRANSPARENT_PIXEL ? null : rawFooterImage;

    const [
      backgroundImageDimensions,
      leftSidebarDimensions,
      footerImageDimensions
    ] = await Promise.all([
      measureImageDimensions(backgroundImage ?? ''),
      measureImageDimensions(leftSidebarImage ?? ''),
      measureImageDimensions(footerImage ?? '')
    ]);

    const pageWidth = PAGE_DIMENSIONS.width;
    const pageHeight = PAGE_DIMENSIONS.height;
    const pageMargins = [60, 50, 70, 60];
    const columnGap = 36;
    const totalContentWidth = Math.max(0, pageWidth - pageMargins[0] - pageMargins[2]);
    const maxLeftColumnWidth = Math.max(totalContentWidth * 0.55, totalContentWidth - 260);
    const preliminaryLeftWidth = Math.max(240, totalContentWidth * LEFT_PANEL_RATIO);
    const leftColumnWidth = Math.min(
      Math.max(0, preliminaryLeftWidth),
      Math.max(0, maxLeftColumnWidth)
    );
    const rightColumnWidth = Math.max(0, totalContentWidth - leftColumnWidth - columnGap);

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
    const readableLocation = location === '________' ? sedeLabel : location;
    const readableDuration = duration === '____' ? '' : `${duration} horas`;

    const formattedLocationLabel = (() => {
      const rawLocation = normaliseText(readableLocation);
      return rawLocation ? rawLocation.toUpperCase() : '________';
    })();

    const rightColumnStack = [
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
        text: `ha superado, con una duración total de ${durationLabel}, la formación de:`,
        style: 'bodyText',
        alignment: 'left',
        margin: [0, 0, 0, 10]
      },
      { text: trainingNameDisplay, style: 'trainingName', alignment: 'left' }
    ];

    const metadataLines: string[] = [];
    if (organizationName) {
      metadataLines.push(`Organizado para ${organizationName}.`);
    }
    if (trainer) {
      metadataLines.push(`Impartido por ${trainer}.`);
    }

    metadataLines.forEach((line) => {
      rightColumnStack.push({ text: line, style: 'metadataText' });
    });

    const detailsAvailableWidth = rightColumnWidth > 0 ? rightColumnWidth : totalContentWidth;
    const trainingDetailsContent = buildTrainingDetailsContent(trainingDetails, {
      practiceColumnShift: detailsAvailableWidth * PRACTICE_COLUMN_SHIFT_RATIO,
      totalAvailableWidth: detailsAvailableWidth,
      boundingWidth: detailsAvailableWidth,
      columnGap: TRAINING_CONTENT_COLUMN_GAP
    });

    if (trainingDetailsContent.length) {
      rightColumnStack.push({ text: 'Contenidos de la formación', style: 'contentSectionTitle' });
      rightColumnStack.push(...trainingDetailsContent);
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

    if (
      footerImage &&
      footerImageDimensions &&
      footerImageDimensions.width > 0 &&
      rightColumnWidth > 0
    ) {
      const targetFooterWidth = rightColumnWidth * FOOTER_SCALE_MULTIPLIER;
      if (targetFooterWidth > 0) {
        rightColumnStack.push({
          image: footerImage,
          width: targetFooterWidth,
          alignment: 'left',
          margin: [0, 32, 0, 0]
        });
      }
    }

    const backgroundDefinitions: Array<Record<string, unknown>> = [];

    if (backgroundImage) {
      const bleed = FULL_BLEED_VERTICAL_BLEED;
      const targetWidth = pageWidth;
      const targetHeight = pageHeight + bleed * 2;
      const targetLeft = 0;
      const targetTop = -bleed;

      if (
        backgroundImageDimensions &&
        backgroundImageDimensions.width > 0 &&
        backgroundImageDimensions.height > 0
      ) {
        const widthScale = targetWidth / backgroundImageDimensions.width;
        const heightScale = targetHeight / backgroundImageDimensions.height;
        const scale = Math.max(widthScale, heightScale);

        const backgroundWidth = backgroundImageDimensions.width * scale;
        const backgroundHeight = backgroundImageDimensions.height * scale;
        const backgroundX = targetLeft + (targetWidth - backgroundWidth) / 2;
        const backgroundY = targetTop + (targetHeight - backgroundHeight) / 2;

        backgroundDefinitions.push({
          image: backgroundImage,
          absolutePosition: { x: backgroundX, y: backgroundY },
          width: backgroundWidth,
          height: backgroundHeight
        });
      } else {
        backgroundDefinitions.push({
          image: backgroundImage,
          absolutePosition: { x: targetLeft, y: targetTop },
          width: targetWidth,
          height: targetHeight
        });
      }
    }

    const decorativeElements: Array<Record<string, unknown>> = [];

    if (
      leftSidebarImage &&
      leftSidebarDimensions &&
      leftSidebarDimensions.width > 0 &&
      leftSidebarDimensions.height > 0
    ) {
      let sidebarScale = LEFT_SIDEBAR_BASE_SCALE;
      const maxSidebarWidth = Math.min(leftColumnWidth, LEFT_SIDEBAR_MAX_WIDTH);

      if (maxSidebarWidth > 0) {
        const scaledWidth = leftSidebarDimensions.width * sidebarScale;
        if (scaledWidth > maxSidebarWidth) {
          sidebarScale = maxSidebarWidth / leftSidebarDimensions.width;
        }
      }

      const sidebarWidth = leftSidebarDimensions.width * sidebarScale;
      const sidebarHeight = leftSidebarDimensions.height * sidebarScale;

      if (sidebarWidth > 0 && sidebarHeight > 0) {
        const sidebarX = 0;
        const sidebarY = pageHeight - sidebarHeight;

        decorativeElements.push({
          image: leftSidebarImage,
          absolutePosition: { x: sidebarX, y: sidebarY },
          width: sidebarWidth,
          height: sidebarHeight,
          opacity: 1
        });
      }
    }

    const docDefinition = {
      pageOrientation: 'landscape',
      pageSize: 'A4',
      pageMargins,
      background: backgroundDefinitions.length ? backgroundDefinitions : null,
      content: [
        ...decorativeElements,
        {
          columns: [
            {
              width: leftColumnWidth,
              stack: leftColumnStack
            },
            {
              width: '*',
              stack: rightColumnStack
            }
          ],
          columnGap
        }
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
