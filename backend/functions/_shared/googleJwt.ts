import { google } from 'googleapis';

function normalizeSaKey(k: string = ''): string {
  const trimmed = (k || '').trim();
  const withRealNewlines = /\\n/.test(trimmed) ? trimmed.replace(/\\n/g, '\n') : trimmed;
  return withRealNewlines.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
}

/**
 * Access token para Gmail (scope gmail.send) impersonando GMAIL_IMPERSONATE.
 * Requiere:
 * - GOOGLE_DRIVE_CLIENT_EMAIL  (service account email)
 * - GOOGLE_DRIVE_PRIVATE_KEY   (PEM con \n literales en Netlify)
 * - GMAIL_IMPERSONATE          (usuario real: erp@gepgroup.es)
 */
export async function getGmailAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '';
  const rawKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY || '';
  const subject = process.env.GMAIL_IMPERSONATE || '';

  if (!clientEmail) throw new Error('Falta GOOGLE_DRIVE_CLIENT_EMAIL');
  if (!rawKey) throw new Error('Falta GOOGLE_DRIVE_PRIVATE_KEY');
  if (!subject) throw new Error('Falta GMAIL_IMPERSONATE');

  const key = normalizeSaKey(rawKey);

  const jwt = new google.auth.JWT({ email: clientEmail,
    key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject, // domain-wide delegation,
  key: normalizeSaKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY || '')
   });

  const { token } = await jwt.authorize();
  if (!token) throw new Error('No se obtuvo access token de Gmail');
  return token;
}
