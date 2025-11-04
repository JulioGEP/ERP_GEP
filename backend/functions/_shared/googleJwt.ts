// backend/functions/_shared/googleJwt.ts
import { google } from "googleapis";

type SaCreds = { client_email: string; private_key: string };

function normalizeKey(k: string): string {
  if (!k) return k;
  let key = k.trim();
  // normaliza saltos
  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // si viene escapada con \\n -> \n real
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  // asegura BEGIN/END
  if (!key.includes("-----BEGIN PRIVATE KEY-----")) {
    key = "-----BEGIN PRIVATE KEY-----\n" + key;
  }
  if (!key.includes("-----END PRIVATE KEY-----")) {
    key = key.trim() + "\n-----END PRIVATE KEY-----\n";
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
  const { client_email, private_key } = loadCreds();
  const jwt = new google.auth.JWT({
    email: client_email,
    key: private_key,
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
