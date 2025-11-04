// backend/functions/_shared/googleJwt.ts
import { google } from "googleapis";

type SaCreds = { client_email: string; private_key: string };

function normalizeKey(k: string): string {
  if (!k) return k;

  // 1) Limpieza básica
  let key = k
    .replace(/^\uFEFF/, "")          // BOM
    .trim()
    // si la UI de Netlify ha guardado la key envuelta en comillas simples o dobles:
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "");

  // 2) Unificar saltos
  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 3) Convertir \n literales a saltos reales (por si la pegaste "escaped")
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");

  // 4) Asegurar cabeceras PEM
  const hasBegin = key.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd = key.includes("-----END PRIVATE KEY-----");

  if (!hasBegin && !hasEnd) {
    // Si viene solo el cuerpo base64, lo envolvemos correctamente
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----\n`;
  } else {
    // Asegura que haya salto tras BEGIN y antes de END
    key = key
      .replace(/-----BEGIN PRIVATE KEY-----\s*/g, "-----BEGIN PRIVATE KEY-----\n")
      .replace(/\s*-----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----\n");
  }

  return key;
}

function loadCreds(): SaCreds {
  const client_email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || "";
  const private_key = normalizeKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY || "");
  if (!client_email || !private_key) {
    throw new Error(
      "Faltan credenciales: define GOOGLE_DRIVE_CLIENT_EMAIL y GOOGLE_DRIVE_PRIVATE_KEY en Netlify."
    );
  }
  return { client_email, private_key };
}

function getScopes(): string[] {
  const env = process.env.GMAIL_SCOPES;
  return env && env.trim()
    ? env.split(",").map((s) => s.trim())
    : ["https://www.googleapis.com/auth/gmail.send"];
}

export async function getGmailClient() {
  const { client_email, private_key } = loadCreds();
  const subject = process.env.GMAIL_IMPERSONATE;
  if (!subject) throw new Error("GMAIL_IMPERSONATE no está definido");

  const jwt = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: getScopes(),
    subject, // Domain-wide delegation
  });

  console.info("[gmail] using client_email:", client_email, "subject:", subject);
  await jwt.authorize(); // fallará aquí si firma/DWD/scope no están bien

  return google.gmail({ version: "v1", auth: jwt });
}

export async function getGmailAccessToken(): Promise<string> {
  const { client_email, private_key: rawKey } = loadCreds();
  const key = normalizeKey(rawKey);
  const jwt = new google.auth.JWT({
    email: client_email,
    key,
    scopes: getScopes(),
    subject: process.env.GMAIL_IMPERSONATE || "",
  });
  console.info("[gmail] (token) using client_email:", client_email);
  const { access_token } = await jwt.authorize();
  if (!access_token) throw new Error("No access_token from Google JWT");
  return access_token;
}

export async function sendGmail(params: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}) {
  const gmail = await getGmailClient();
  const fromAddr = params.from || process.env.GMAIL_IMPERSONATE!;
  const headers = [
    `From: ${fromAddr}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    params.replyTo ? `Reply-To: ${params.replyTo}` : null,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
  ].filter(Boolean) as string[];

  const raw = Buffer.from([...headers, params.html].join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    console.info("[gmail] sent status:", res.status, res.statusText, "id:", res.data.id);
    return res.data.id;
  } catch (e: any) {
    const data = e?.response?.data ?? e?.message ?? e;
    console.error("[gmail] send error:", JSON.stringify(data));
    throw e;
  }
}
