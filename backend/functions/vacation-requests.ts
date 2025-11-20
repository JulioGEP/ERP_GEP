// backend/functions/vacation-requests.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { requireAuth } from './_shared/auth';
import { sendEmail } from './_shared/mailer';

const RECIPIENT = 'julio.garcia.becerra@gmail.com';

function parseDateOnly(value: unknown): string | null {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : String(value);
  if (!input.length) return null;
  const normalized = input.includes('T') ? input.split('T')[0] : input;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatHumanDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
}

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const startDate = parseDateOnly(request.body.startDate ?? request.body.start_date);
  const endDate = parseDateOnly(request.body.endDate ?? request.body.end_date);
  const notes = typeof request.body.notes === 'string' ? request.body.notes.trim() : '';

  if (!startDate || !endDate) {
    return errorResponse('VALIDATION_ERROR', 'Las fechas de inicio y fin son obligatorias', 400);
  }

  const recipient = auth.user.email
    ? `${RECIPIENT}, ${auth.user.email}`
    : RECIPIENT;

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; max-width:640px">
      <h2>Petición de vacaciones</h2>
      <p><strong>Usuario:</strong> ${auth.user.first_name} ${auth.user.last_name ?? ''} (${auth.user.email})</p>
      <p><strong>Fechas solicitadas:</strong> ${formatHumanDate(startDate)} → ${formatHumanDate(endDate)}</p>
      ${notes ? `<p><strong>Notas:</strong> ${notes}</p>` : ''}
      <p style="margin-top:16px;color:#555">Enviado automáticamente desde ERP.</p>
    </div>
  `;

  await sendEmail({
    to: recipient,
    subject: 'Petición de vacaciones',
    html,
    text: `Petición de vacaciones\nUsuario: ${auth.user.first_name} ${auth.user.last_name ?? ''} (${auth.user.email})\nFechas: ${startDate} -> ${endDate}${
      notes ? `\nNotas: ${notes}` : ''
    }`,
  });

  return successResponse({ message: 'Petición enviada correctamente' });
});
