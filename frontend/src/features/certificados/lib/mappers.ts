import type { DealDetail, DealProduct } from '../../../types/deal';
import type { SessionDTO, SessionStudent } from '../../presupuestos/api';

export type CertificateSession = SessionDTO & {
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

function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMATTER.format(date);
}

function formatNumber(value?: number | null): string {
  if (value === null || value === undefined) return '';
  if (Number.isNaN(value)) return '';
  return String(value);
}

export function mapSessionToCertificateSession(
  session: SessionDTO,
  options: { product?: DealProduct | null; fallbackProductName?: string | null } = {},
): CertificateSession {
  const product = options.product ?? null;
  const fallbackName = options.fallbackProductName ?? null;

  return {
    ...session,
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
  const fecha = formatDate(session?.fecha_inicio_utc);
  const horas = formatNumber(session?.productHours ?? null);
  const formacion = session?.productName ?? '';

  return students.map((student) => ({
    id: student.id,
    presu: dealId,
    nombre: student.nombre,
    apellidos: student.apellido,
    dni: student.dni,
    fecha,
    fecha2: '',
    lugar,
    horas,
    cliente,
    formacion,
    irata: '',
    certificado: Boolean(student.certificado),
    driveUrl: student.drive_url ?? null,
  }));
}
