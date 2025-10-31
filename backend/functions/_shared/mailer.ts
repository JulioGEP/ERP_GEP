import { createSign, randomBytes } from 'crypto';
import { requireEnv } from './env';
import { normalizeEmail } from './auth';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const JWT_AUDIENCE = GOOGLE_TOKEN_URL;
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 60 * 1000; // 60 segundos
const RESET_LINK_VALIDITY_MINUTES = 10;

export type PasswordResetEmailParams = {
  to: string;
  resetUrl: string;
  expiresAt: Date;
  firstName?: string | null;
  lastName?: string | null;
};

type GmailCredentials = {
  clientEmail: string;
  privateKey: string;
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

let cachedCredentials: GmailCredentials | null = null;
let cachedToken: CachedToken | null = null;
let pendingTokenPromise: Promise<string> | null = null;

const senderInfo = parseSender(requireEnv('GMAIL_SENDER'));

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const recipient = normalizeEmail(params.to);
  if (!recipient) {
    throw new Error('PASSWORD_RESET_EMAIL_INVALID_RECIPIENT');
  }

  if (!params.resetUrl || typeof params.resetUrl !== 'string') {
    throw new Error('PASSWORD_RESET_EMAIL_INVALID_URL');
  }

  const accessToken = await getAccessToken();
  const rawMessage = buildPasswordResetMimeMessage({
    ...params,
    to: recipient,
  });

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawMessage }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      cachedToken = null;
    }
    const errorBody = await safeReadBody(response);
    throw new Error(`PASSWORD_RESET_EMAIL_DELIVERY_FAILED:${response.status}:${errorBody}`);
  }
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + TOKEN_EXPIRY_SAFETY_WINDOW_MS) {
    return cachedToken.value;
  }

  if (pendingTokenPromise) {
    return pendingTokenPromise;
  }

  pendingTokenPromise = requestAccessToken().finally(() => {
    pendingTokenPromise = null;
  });

  return pendingTokenPromise;
}

async function requestAccessToken(): Promise<string> {
  const credentials = getGmailCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = toBase64Url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: GMAIL_SEND_SCOPE,
      aud: JWT_AUDIENCE,
      exp: now + 60 * 60,
      iat: now,
      sub: senderInfo.address,
    }),
  );

  const unsignedToken = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  const signature = toBase64Url(signer.sign(credentials.privateKey));
  const assertion = `${unsignedToken}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await safeReadBody(response);
    throw new Error(`PASSWORD_RESET_EMAIL_TOKEN_FAILED:${response.status}:${errorBody}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!json?.access_token) {
    throw new Error('PASSWORD_RESET_EMAIL_TOKEN_RESPONSE_INVALID');
  }

  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  const value = json.access_token;
  const expiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
  cachedToken = { value, expiresAt };
  return value;
}

function getGmailCredentials(): GmailCredentials {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const raw = requireEnv('GMAIL_PRIVATE_KEY');
  const trimmed = raw.trim();
  let privateKey = '';
  let clientEmail = (process.env.GMAIL_CLIENT_EMAIL ?? '').trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.private_key === 'string' && parsed.private_key.trim().length) {
        privateKey = parsed.private_key;
      }
      if (typeof parsed.client_email === 'string' && parsed.client_email.trim().length) {
        clientEmail = clientEmail || parsed.client_email.trim();
      }
    } catch (error) {
      throw new Error('PASSWORD_RESET_EMAIL_INVALID_PRIVATE_KEY_JSON');
    }
  } else {
    privateKey = trimmed;
  }

  privateKey = (privateKey || '').replace(/\\n/g, '\n').trim();
  clientEmail = clientEmail.trim();

  if (!privateKey.length) {
    throw new Error('PASSWORD_RESET_EMAIL_PRIVATE_KEY_MISSING');
  }

  if (!clientEmail.length) {
    throw new Error('PASSWORD_RESET_EMAIL_CLIENT_EMAIL_MISSING');
  }

  cachedCredentials = { clientEmail, privateKey };
  return cachedCredentials;
}

type SenderInfo = {
  address: string;
  formatted: string;
  displayName: string | null;
};

function parseSender(raw: string): SenderInfo {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    throw new Error('PASSWORD_RESET_EMAIL_SENDER_INVALID');
  }

  const angleMatch = trimmed.match(/<([^>]+)>/);
  let address = angleMatch ? angleMatch[1]?.trim() ?? '' : trimmed;
  const normalized = normalizeEmail(address);
  if (!normalized) {
    throw new Error('PASSWORD_RESET_EMAIL_SENDER_INVALID_ADDRESS');
  }

  let displayName: string | null = null;
  if (angleMatch) {
    const before = trimmed.slice(0, angleMatch.index).trim();
    displayName = before.length ? before : null;
  }

  const formatted = displayName ? `${displayName} <${normalized}>` : normalized;
  return { address: normalized, formatted, displayName };
}

function buildPasswordResetMimeMessage(params: PasswordResetEmailParams & { to: string }): string {
  const boundary = `=reset-${randomBytes(12).toString('hex')}`;
  const subject = encodeMimeHeader('Restablece tu contraseña');
  const plainBody = buildPlainBody(params);
  const htmlBody = buildHtmlBody(params);

  const lines: string[] = [
    `From: ${senderInfo.formatted}`,
    `To: ${params.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    plainBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
    '',
  ];

  const message = lines.join('\r\n');
  return toBase64Url(Buffer.from(message, 'utf8'));
}

function buildPlainBody({ resetUrl, firstName }: PasswordResetEmailParams): string {
  const greeting = firstName ? `Hola ${sanitizeName(firstName)},` : 'Hola,';
  return [
    greeting,
    '',
    'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta del ERP.',
    'Haz clic en el siguiente enlace para crear una nueva contraseña:',
    resetUrl,
    '',
    `Este enlace es válido durante los próximos ${RESET_LINK_VALIDITY_MINUTES} minutos.`,
    'Si tú no solicitaste el cambio, puedes ignorar este mensaje.',
    '',
    'Equipo GEP',
  ].join('\n');
}

function buildHtmlBody({ resetUrl, firstName }: PasswordResetEmailParams): string {
  const greeting = firstName ? `Hola ${escapeHtml(sanitizeName(firstName))},` : 'Hola,';
  const escapedUrl = escapeHtml(resetUrl);
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />',
    '  <title>Restablece tu contraseña</title>',
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f5f6f8;">',
    '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f6f8;padding:24px 0;">',
    '    <tr>',
    '      <td align="center">',
    '        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:12px;padding:32px;font-family:Arial,sans-serif;color:#1f2933;">',
    '          <tr>',
    '            <td style="font-size:18px;line-height:28px;">',
    `              <p style="margin:0 0 16px 0;">${greeting}</p>`,
    '              <p style="margin:0 0 16px 0;">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta del ERP.</p>',
    '              <p style="margin:0 0 24px 0;">Haz clic en el siguiente botón para crear una nueva contraseña:</p>',
    '              <p style="margin:0 0 32px 0;">',
    `                <a href="${escapedUrl}" style="display:inline-block;background-color:#0069d9;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600;">Crear contraseña</a>`,
    '              </p>',
    '              <p style="margin:0 0 16px 0;font-size:15px;color:#52606d;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>',
    `              <p style="margin:0 0 24px 0;word-break:break-all;"><a href="${escapedUrl}" style="color:#0069d9;">${escapedUrl}</a></p>`,
    `              <p style="margin:0 0 8px 0;">El enlace caduca en ${RESET_LINK_VALIDITY_MINUTES} minutos.</p>`,
    '              <p style="margin:0;">Si tú no solicitaste el cambio, puedes ignorar este mensaje.</p>',
    '            </td>',
    '          </tr>',
    '        </table>',
    '      </td>',
    '    </tr>',
    '  </table>',
    '</body>',
    '</html>',
  ].join('\n');
}

function encodeMimeHeader(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

function toBase64Url(input: string | Buffer): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sanitizeName(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
