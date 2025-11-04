import { google } from 'googleapis';

type SaCreds = { client_email: string; private_key: string };

function normalizeKey(k: string): string {
  if (!k) return k;
  // Quitar comillas sobrantes y normalizar saltos
  let key = k.trim();
  // Si viene con \r\n o \r -> a \n
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Si viene “escaped” como \\n -> \n real
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  // Asegurar cabeceras
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    key = '-----BEGIN PRIVATE KEY-----\n' + key;
  }
  if (!key.includes('-----END PRIVATE KEY-----')) {
    key = key.trim() + '\n-----END PRIVATE KEY-----\n';
  }
  return key;
}

/**
 * Carga credenciales con prioridad:
 * 1) GOOGLE_SERVICE_ACCOUNT_JSON (JSON completo)
 * 2) GOOGLE_DRIVE_CLIENT_EMAIL + GOOGLE_DRIVE_PRIVATE_KEY
 */
function loadCreds(): SaCreds {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().length > 0) {
    const parsed = JSON.parse(raw) as any;
    return {
      client_email: parsed.client_email,
      private_key: normalizeKey(parsed.private_key),
    };
  }
  const client_email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '';
  const private_key = normalizeKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY || '');
  if (!client_email || !private_key) {
    throw new Error(
      'Missing SA creds. Provide GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_CLIENT_EMAIL + GOOGLE_DRIVE_PRIVATE_KEY'
    );
  }
  return { client_email, private_key };
}

export async function getGmailAccessToken(): Promise<string> {
  const { client_email, private_key } = loadCreds();

  const subject = process.env.GMAIL_IMPERSONATE || ''; // ej: erp@gepgroup.es
  const scopes = ['https://www.googleapis.com/auth/gmail.send'];

  const jwt = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes,
    subject, // Domain-wide delegation
  });

  const { access_token } = await jwt.authorize();
  if (!access_token) throw new Error('No access_token from Google JWT');
  return access_token;
}
