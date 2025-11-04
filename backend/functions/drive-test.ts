import type { Handler } from "@netlify/functions";
import { getDriveClient } from "./_shared/googleJwtDrive";
import { Readable } from "stream";

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };

  try {
    const { action, name, content, parentId, mimeType } = JSON.parse(event.body || "{}");
    const drive = await getDriveClient();

    if (action === "about") {
      const about = await drive.about.get({ fields: "user(emailAddress,displayName)" });
      return json(200, { ok: true, user: about.data.user });
    }

    if (action === "list") {
      const res = await drive.files.list({
        pageSize: 10,
        fields: "files(id,name,mimeType,webViewLink,owners(emailAddress))",
        q: parentId ? `'${parentId}' in parents and trashed = false` : "trashed = false",
      });
      return json(200, { ok: true, files: res.data.files });
    }

    if (action === "createFolder") {
      const created = await drive.files.create({
        requestBody: {
          name: name || `erp-folder-${Date.now()}`,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : undefined,
        },
        fields: "id,name,webViewLink",
      });
      return json(200, { ok: true, folder: created.data });
    }

    // action === "upload"
    const fileName = name || `erp-drive-test-${Date.now()}.txt`;
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from("Hola Drive");
    const stream = Readable.from(data); // ⬅️ FIX: stream legible

    const created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: parentId ? [parentId] : undefined,
      },
      media: {
        mimeType: mimeType || "text/plain",
        body: stream, // ⬅️ usa stream, no Buffer directo
      },
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
