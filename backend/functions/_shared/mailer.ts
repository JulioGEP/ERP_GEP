// backend/functions/_shared/mailer.ts



function normalizeSaKey(k: string = ''): string {
  const trimmed = (k || '').trim();
  const hasLiteral = /\\n/.test(trimmed); // busca \n literales
  const materialized = hasLiteral ? trimmed.replace(/\\n/g, '\n') : trimmed;
  return materialized.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
}


import { google } from 'googleapis';

function normalizePrivateKey(k: string): string {
  if (!k) return '';
  let key = k.replace(/\\n/g, '\n');
  key = key.replace(/-BEGIN PRIVATE KEY-\n?/, '-BEGIN PRIVATE KEY-\n');
  key = key.replace(/\n?-END PRIVATE KEY-/, '\n-END PRIVATE KEY-');
  return key;
}

function getPrivateKey(): string {
  const b64 = process.env.GOOGLE_DRIVE_PRIVATE_KEY_B64 || '';
  if (b64 && !b64.includes('BEGIN')) {
    try { return Buffer.from(b64, 'base64').toString('utf8'); } catch {}
  }
  return normalizePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY || '');
}

import { normalizeEmail } from './auth';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users';

type ServiceAccount = {
  clientEmail: string;
  privateKey: string;
};

type MailerConfig = {
  fromAddress: string;
  fromName: string | null;
  replyToAddress: string;
  replyToName: string | null;
  impersonate: string;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

type PasswordResetEmailParams = {
  toEmail: string;
  toName?: string | null;
  resetUrl: string;
  expiresAt?: Date | null;
};

let cachedServiceAccount: ServiceAccount | null | undefined;
let cachedMailerConfig: MailerConfig | null | undefined;
let cachedToken: TokenCache | null = null;

function getServiceAccount(): ServiceAccount {
  if (cachedServiceAccount !== undefined) {
    if (cachedServiceAccount === null) {
      throw new Error('Credenciales de Google no configuradas');
    }
    return cachedServiceAccount;
  }

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!clientEmail || !privateKeyRaw) {
    cachedServiceAccount = null;
    throw new Error('Faltan GOOGLE_DRIVE_CLIENT_EMAIL o GOOGLE_DRIVE_PRIVATE_KEY');
  }

  cachedServiceAccount = {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
  };

  return cachedServiceAccount;
}

function getMailerConfig(): MailerConfig {
  if (cachedMailerConfig !== undefined) {
    if (cachedMailerConfig === null) {
      throw new Error('Configuración de correo incompleta');
    }
    return cachedMailerConfig;
  }

  const fromAddress = process.env.MAIL_FROM_ADDRESS?.trim();
  const fromName = process.env.MAIL_FROM_NAME?.trim() || null;
  const impersonate = process.env.GMAIL_IMPERSONATE?.trim();

  if (!fromAddress) {
    cachedMailerConfig = null;
    throw new Error('MAIL_FROM_ADDRESS no está configurado');
  }

  const normalizedFrom = normalizeEmail(fromAddress) ?? fromAddress;
  const replyToDomain = normalizedFrom.includes('@') ? normalizedFrom.split('@')[1] : null;
  const replyToAddress = process.env.MAIL_REPLY_TO?.trim()
    ? process.env.MAIL_REPLY_TO.trim()
    : replyToDomain
      ? `no-reply@${replyToDomain}`
      : normalizedFrom;

  const replyToName = fromName ? `${fromName} (no responder)` : 'No responder';

  cachedMailerConfig = {
    fromAddress: normalizedFrom,
    fromName,
    replyToAddress,
    replyToName,
    impersonate: impersonate || normalizedFrom,
  };

  return cachedMailerConfig;
}

function base64UrlEncode(input: string | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const { clientEmail, privateKey } = getServiceAccount();
  const { impersonate } = getMailerConfig();

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: GMAIL_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
      sub: impersonate,
    }),
  );

  const signer = /* removed manual sign */
  const assertion = `${header}.${payload}.${base64UrlEncode(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `No se pudo obtener el token de acceso de Gmail (${response.status} ${response.statusText}): ${errorText}`,
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  const accessToken = data.access_token;
  if (!accessToken) {
    throw new Error('La respuesta de Google no contiene access_token');
  }

  const expiresIn = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
    ? data.expires_in
    : 3600;

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

function formatAddress(name: string | null, address: string): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    const safeName = trimmedName.replace(/"/g, '\\"');
    return `"${safeName}" <${address}>`;
  }
  return address;
}

function encodeSubject(subject: string): string {
  if (!subject) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPasswordResetMessage(params: Required<PasswordResetEmailParams> & MailerConfig) {
  const { toEmail, toName, resetUrl, expiresAt, fromAddress, fromName, replyToAddress, replyToName } = params;

  const formattedFrom = formatAddress(fromName, fromAddress);
  const formattedReplyTo = formatAddress(replyToName, replyToAddress);
  const formattedTo = normalizeEmail(toEmail) ?? toEmail;
  const recipientName = toName?.trim() || formattedTo;

  const formatter = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  });

  const expiresLabel = expiresAt ? formatter.format(expiresAt) : null;

  const textLines = [
    `Hola ${recipientName},`,
    '',
    'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta del ERP de GEP Group.',
    'Si has sido tú, utiliza el siguiente enlace para crear una contraseña nueva:',
    resetUrl,
  ];

  if (expiresLabel) {
    textLines.push('', `El enlace caduca el ${expiresLabel}.`);
  }

  textLines.push(
    '',
    'Si tú no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá siendo válida.',
    '',
    'Este mensaje se ha enviado desde una dirección no monitorizada. Por favor, no respondas a este correo.',
    '',
    '— Equipo ERP · GEP Group',
  );

  const textBody = textLines.join('\n');

  const htmlBody = [
    `<p>Hola ${escapeHtml(recipientName)},</p>`,
    '<p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta del ERP de GEP Group.</p>',
    `<p>Si has sido tú, haz clic en el siguiente enlace para crear una contraseña nueva:</p>`,
    `<p><a href="${escapeHtml(resetUrl)}" target="_blank" rel="noopener noreferrer">Restablecer contraseña</a></p>`,
    expiresLabel ? `<p>El enlace caduca el ${escapeHtml(expiresLabel)}.</p>` : '',
    '<p>Si tú no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá siendo válida.</p>',
    '<p><strong>Este mensaje se ha enviado desde una dirección no monitorizada. No respondas a este correo.</strong></p>',
    '<p>— Equipo ERP · GEP Group</p>',
  ]
    .filter(Boolean)
    .join('\n');

  const boundary = `=_Boundary_${Date.now().toString(36)}`;

  const message = [
    `From: ${formattedFrom}`,
    `To: ${formattedTo}`,
    `Reply-To: ${formattedReplyTo}`,
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
    `Subject: ${encodeSubject('Restablece tu contraseña de GEP Group ERP')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return base64UrlEncode(Buffer.from(message, 'utf8'));
}

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  getServiceAccount();
  const mailerConfig = getMailerConfig();

  const { toEmail, resetUrl } = params;
  if (!toEmail || !resetUrl) {
    throw new Error('Faltan parámetros obligatorios para enviar el correo de restablecimiento');
  }

  const emailPayload = buildPasswordResetMessage({
    ...params,
    ...mailerConfig,
    toEmail,
    expiresAt: params.expiresAt ?? null,
    toName: params.toName ?? null,
  });

  const accessToken = await getAccessToken();

  const response = await fetch(
    `${GMAIL_API_BASE}/${encodeURIComponent(mailerConfig.impersonate)}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: emailPayload }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Fallo al enviar el correo de restablecimiento (${response.status} ${response.statusText}): ${errorText}`,
    );
  }
}

