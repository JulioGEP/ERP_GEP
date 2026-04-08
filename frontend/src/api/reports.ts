import { getJson, postJson } from './client';

export type ReportListEntry = {
  id: string;
  presupuesto: string | null;
  empresa: string | null;
  sesion: string | null;
  fecha: string | null;
  formador: string | null;
  enlace: string | null;
  contact_email: string | null;
  archivo: string | null;
  registrado_en: string | null;
  email_enviado_en: string | null;
};

export type ReportListResponse = {
  reports: ReportListEntry[];
};

export async function fetchReportList() {
  return getJson<ReportListResponse>('/reports-list');
}

export type SendReportEmailPayload = {
  reportId: string;
  senderName: string;
  senderEmail: string;
  to: string;
  cc?: string;
  body: string;
};

export async function sendReportEmail(payload: SendReportEmailPayload) {
  return postJson<{ message: string }>('/report-send', payload);
}
