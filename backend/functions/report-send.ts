import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { sendEmail } from './_shared/mailer';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

type ReportSendBody = {
  reportId?: unknown;
  senderName?: unknown;
  senderEmail?: unknown;
  to?: unknown;
  cc?: unknown;
  body?: unknown;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const REPORT_SIGNATURE_HTML = '';

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseEmailList = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  const entries = value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(entries));
};

const isValidEmail = (value: string): boolean => EMAIL_REGEX.test(value);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildHtmlBody = (plainText: string): string =>
  `<div style="white-space: pre-wrap; font-family: Arial, sans-serif;">${escapeHtml(plainText)}</div>${REPORT_SIGNATURE_HTML}`;

export const handler = createHttpHandler<ReportSendBody>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'El cuerpo de la petición es obligatorio', 400);
  }

  const reportId = normalizeString(request.body.reportId);
  const senderName = normalizeString(request.body.senderName);
  const senderEmail = normalizeString(request.body.senderEmail).toLowerCase();
  const body = normalizeString(request.body.body);
  const toList = parseEmailList(request.body.to);
  const ccList = parseEmailList(request.body.cc);

  if (!reportId) {
    return errorResponse('VALIDATION_ERROR', 'Debes indicar el informe a enviar', 400);
  }

  if (!senderName) {
    return errorResponse('VALIDATION_ERROR', 'El nombre del remitente es obligatorio', 400);
  }

  if (!senderEmail || !isValidEmail(senderEmail)) {
    return errorResponse('VALIDATION_ERROR', 'El email del remitente no es válido', 400);
  }

  if (!toList.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes indicar al menos un destinatario', 400);
  }

  if (toList.some((email) => !isValidEmail(email)) || ccList.some((email) => !isValidEmail(email))) {
    return errorResponse('VALIDATION_ERROR', 'Hay direcciones de email no válidas en Para o CC', 400);
  }

  if (!body) {
    return errorResponse('VALIDATION_ERROR', 'El cuerpo del mensaje es obligatorio', 400);
  }

  const report = await prisma.sesion_files.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      deal_id: true,
      drive_file_name: true,
      drive_web_view_link: true,
    },
  });

  if (!report || !report.drive_web_view_link) {
    return errorResponse('NOT_FOUND', 'No se ha encontrado el informe seleccionado', 404);
  }

  const subjectBudget = report.deal_id ? `Presupuesto ${report.deal_id}` : report.drive_file_name ?? 'Informe';
  const subject = `Informe · ${subjectBudget}`;

  await sendEmail({
    to: toList.join(', '),
    cc: ccList.length ? ccList.join(', ') : undefined,
    from: `${senderName} <${senderEmail}>`,
    subject,
    html: buildHtmlBody(body),
    text: body,
  });

  await prisma.sesion_files.update({
    where: { id: report.id },
    data: { report_email_sent_at: new Date() },
  });

  return successResponse({ message: 'Informe enviado correctamente' });
});

export default handler;
