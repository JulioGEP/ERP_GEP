import { getJson } from './client';

export type ReportListEntry = {
  id: string;
  presupuesto: string | null;
  empresa: string | null;
  sesion: string | null;
  fecha: string | null;
  formador: string | null;
  enlace: string | null;
  archivo: string | null;
  registrado_en: string | null;
};

export type ReportListResponse = {
  reports: ReportListEntry[];
};

export async function fetchReportList() {
  return getJson<ReportListResponse>('/reports-list');
}
