import { google } from "googleapis";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

type SaCreds = {
  client_email: string;
  private_key: string;
};

function normalizeKey(raw: string): string {
  if (!raw) return raw;

  let key = raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "");

  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }

  const hasBegin = key.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd = key.includes("-----END PRIVATE KEY-----");

  if (!hasBegin && !hasEnd) {
    key = `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----\n`;
  } else {
    key = key
      .replace(/-----BEGIN PRIVATE KEY-----\s*/g, "-----BEGIN PRIVATE KEY-----\n")
      .replace(/\s*-----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----\n");
  }

  return key;
}

function loadCreds(): SaCreds {
  const client_email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || "";
  const private_key = process.env.GOOGLE_DRIVE_PRIVATE_KEY || "";

  if (!client_email || !private_key) {
    throw new Error("Faltan credenciales de Google Drive: define GOOGLE_DRIVE_CLIENT_EMAIL y GOOGLE_DRIVE_PRIVATE_KEY.");
  }

  return {
    client_email,
    private_key: normalizeKey(private_key),
  };
}

export async function getDriveClient() {
  const { client_email, private_key } = loadCreds();
  const subject = process.env.GOOGLE_DRIVE_IMPERSONATE?.trim();

  const jwt = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: DRIVE_SCOPES,
    subject: subject || undefined,
  });

  await jwt.authorize();

  return google.drive({ version: "v3", auth: jwt });
}
