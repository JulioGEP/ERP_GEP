import nodemailer from 'nodemailer';
import { getGmailAccessToken } from './googleJwt';

/**
 * Envía email usando Gmail vía OAuth2 (XOAUTH2) con accessToken JWT.
 * Requiere GMAIL_IMPERSONATE como usuario emisor.
 */
export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  fromName?: string;
}): Promise<void> {
  const { to, subject, html, text, fromName = 'ERP GEP' } = opts;
  const user = process.env.GMAIL_IMPERSONATE || '';
  if (!user) throw new Error('Falta GMAIL_IMPERSONATE');

  const accessToken = await getGmailAccessToken();

  // Nodemailer acepta OAuth2 con solo accessToken
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user,
      accessToken,
    },
  });

  await transporter.sendMail({
    from: `${fromName} <${user}>`,
    to,
    subject: subject?.trim() || '(sin asunto)',
    text,
    html,
  });
}
