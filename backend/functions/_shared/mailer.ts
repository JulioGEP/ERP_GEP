import nodemailer from 'nodemailer';
import { getGmailAccessToken } from './googleJwt';

const FROM = (process.env.GMAIL_IMPERSONATE || '').trim();
if (!FROM) {
  // No tiramos la build, pero dejamos claro en runtime
  // eslint-disable-next-line no-console
  console.warn('[mailer] GMAIL_IMPERSONATE no está definido');
}

type SendEmailParams = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

/**
 * Envia email usando Gmail vía OAuth2 con accessToken obtenido por JWT (service account + domain-wide delegation).
 * No usa claves PEM directas en Node crypto (evita errores de OpenSSL).
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
  const accessToken = await getGmailAccessToken();

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: FROM,
      accessToken,
    },
  });

  await transport.sendMail({
    from: FROM,
    to,
    subject,
    text,
    html,
  });
}

/**
 * Export requerido por auth-password-reset-request.ts
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const subject = 'Instrucciones para restablecer tu contrase\u00F1a';
  const html = [
    '<p>Hola,</p>',
    '<p>Recibimos una solicitud para restablecer tu contrase\u00F1a. Sigue el enlace para crear una nueva:</p>',
    `<p><a href="${resetUrl}" style="background:#0b5ed7;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Restablecer contrase\u00F1a</a></p>`,
    '<p>Si el bot\u00F3n no funciona, copia y pega este enlace en tu navegador:</p>',
    `<p><a href="${resetUrl}">${resetUrl}</a></p>`,
    '<p>Si no solicitaste este cambio, puedes ignorar este correo.</p>',
  ].join('');
  const text = [
    'Hola,',
    'Recibimos una solicitud para restablecer tu contrase\u00F1a.',
    `Abre este enlace para continuar: ${resetUrl}`,
    'Si no solicitaste este cambio, ignora este correo.',
  ].join('\n');

  await sendEmail({ to, subject, html, text });
}
