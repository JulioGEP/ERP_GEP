import type { DealDetail, DealProduct } from '../../../types/deal';
import type { SessionDTO, SessionStudent } from "../../../api/sessions.types";

export type CertificateSession = SessionDTO & {
  productId: string | null;
  productName: string | null;
  productHours: number | null;
  productTemplate: string | null;
};

export type CertificateRow = {
  id: string;
  presu: string;
  nombre: string;
  apellidos: string;
  dni: string;
  fecha: string;
  fecha2: string;
  lugar: string;
  horas: string;
  cliente: string;
  formacion: string;
  irata: string;
  certificado: boolean;
  driveUrl: string | null;
};

const DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function parseDate(value?: string | null): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const match = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, dayStr, monthStr, yearStr] = match;
  const day = Number.parseInt(dayStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1;
  const year = Number.parseInt(yearStr, 10);

  const normalized = new Date(year, month, day);
  if (
    normalized.getFullYear() !== year ||
    normalized.getMonth() !== month ||
    normalized.getDate() !== day
  ) {
    return null;
  }

  return normalized;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return DATE_FORMATTER.format(date);
}

function formatNumber(value?: number | null): string {
  if (value === null || value === undefined) return '';
  if (Number.isNaN(value)) return '';
  return String(value);
}

function normalizePipelineValue(value?: string | null): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isOpenTrainingDeal(deal: DealDetail | null): boolean {
  if (!deal) return false;
  const pipelineValues: Array<string | null | undefined> = [
    deal.pipeline_label,
    deal.pipeline_id ? String(deal.pipeline_id) : null,
  ];
  return pipelineValues.some((value) =>
    normalizePipelineValue(value).includes('formacion abierta'),
  );
}

export function mapSessionToCertificateSession(
  session: SessionDTO,
  options: { product?: DealProduct | null; fallbackProductName?: string | null } = {},
): CertificateSession {
  const product = options.product ?? null;
  const fallbackName = options.fallbackProductName ?? null;

  return {
    ...session,
    productId: product?.id ?? session.deal_product_id ?? null,
    productName: product?.name ?? fallbackName ?? null,
    productHours: product?.hours ?? null,
    productTemplate: product?.template ?? null,
  };
}

export function mapStudentsToCertificateRows(params: {
  students: SessionStudent[];
  deal: DealDetail | null;
  session: CertificateSession | null;
}): CertificateRow[] {
  const { students, deal, session } = params;

  const dealId = deal?.deal_id ? String(deal.deal_id) : '';
  const lugar = deal?.sede_label ? String(deal.sede_label) : '';
  const cliente = deal?.organization?.name ? String(deal.organization.name) : '';
  const fechaSource = isOpenTrainingDeal(deal)
    ? deal?.a_fecha ?? session?.fecha_inicio_utc ?? ''
    : session?.fecha_inicio_utc ?? '';
  const fechaDate = fechaSource ? parseDate(fechaSource) : null;
  const fecha = formatDate(fechaDate ?? fechaSource);
  let fecha2 = '';
  const productId = session?.productId ?? null;
  const productName = session?.productName ?? '';
  const normalizedProductName = normalizePipelineValue(productName);
  const normalizedProductId = productId != null ? String(productId).trim() : '';
  const shouldIncludeSecondDate =
    normalizedProductId === '212' ||
    normalizedProductName === normalizePipelineValue('A- Trabajos Verticales');
  if (shouldIncludeSecondDate && fechaDate && !Number.isNaN(fechaDate.getTime())) {
    const nextDay = new Date(fechaDate);
    nextDay.setDate(nextDay.getDate() + 1);
    fecha2 = formatDate(nextDay);
  }
  const horas = formatNumber(session?.productHours ?? null);
  const formacion = isOpenTrainingDeal(deal) ? 'A- Trabajos verticales' : session?.productName ?? '';

  return students.map((student) => ({
    id: student.id,
    presu: dealId,
    nombre: student.nombre,
    apellidos: student.apellido,
    dni: student.dni,
    fecha,
    fecha2,
    lugar,
    horas,
    cliente,
    formacion,
    irata: '',
    certificado: Boolean(student.certificado),
    driveUrl: student.drive_url ?? null,
  }));
}
