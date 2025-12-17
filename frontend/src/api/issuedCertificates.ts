import { getJson } from './client';

export type IssuedCertificate = {
  id: string;
  presupuesto: string;
  presupuesto_titulo: string | null;
  alumno_nombre: string;
  alumno_apellido: string;
  fecha_formacion: string | null;
  empresa: string | null;
  formacion: string | null;
  drive_url: string | null;
};

export type IssuedCertificateFilters = {
  presupuesto?: string;
  alumno?: string;
  fecha_formacion?: string;
  empresa?: string;
  formacion?: string;
  page?: number;
};

export type IssuedCertificatesResponse = {
  items: IssuedCertificate[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

export async function fetchIssuedCertificates(filters: IssuedCertificateFilters) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text.length === 0) continue;
    params.append(key, text);
  }

  const query = params.toString();
  const url = query ? `/issued-certificates?${query}` : '/issued-certificates';

  return getJson<IssuedCertificatesResponse>(url);
}
