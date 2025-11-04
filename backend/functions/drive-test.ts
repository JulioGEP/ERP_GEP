import type { Handler } from "@netlify/functions";
import { getDriveClient } from "./_shared/googleJwtDrive";

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { action, name, content, parentId } = JSON.parse(event.body || "{}");

    const drive = await getDriveClient();

    if (action === "about") {
      const about = await drive.about.get({ fields: "user(emailAddress,displayName)" });
      return json(200, { ok: true, user: about.data.user });
    }

    if (action === "list") {
      const res = await drive.files.list({
        pageSize: 10,
        fields: "files(id,name,mimeType,owners(emailAddress))",
        q: parentId ? `'${parentId}' in parents and trashed = false` : "trashed = false",
      });
      return json(200, { ok: true, files: res.data.files });
    }

    // action === "upload" (sube un pequeño txt para probar)
    const fileName = name || `erp-drive-test-${Date.now()}.txt`;
    const data = content || `Test de subida ${new Date().toISOString()}`;
    const fileMetadata: any = { name: fileName };
    if (parentId) fileMetadata.parents = [parentId];

    const media = {
      mimeType: "text/plain",
      body: Buffer.from(data, "utf8"),
    } as any;

    const created = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id,name,webViewLink,owners(emailAddress)",
    });

    return json(200, { ok: true, file: created.data });
  } catch (e: any) {
    const detail = e?.response?.data ?? e?.errors ?? e?.message ?? String(e);
    console.error("[drive-test] error:", detail);
    return json(502, { ok: false, detail });
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { ...cors(), "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify(body),
  };
}
