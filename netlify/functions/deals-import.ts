// /.netlify/functions/deals-import
type Event = { httpMethod: string; rawUrl: string; body: string | null };
type Resp  = { statusCode: number; headers: Record<string,string>; body: string };

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const TOKEN = process.env.PIPEDRIVE_API_TOKEN?.trim() || "";
const HOSTS = ["https://api.pipedrive.com/v1", "https://api-eu.pipedrive.com/v1"]; // fallback EU

export const handler = async (event: Event): Promise<Resp> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    if (event.httpMethod !== "POST") return resp(405, { error: "Method Not Allowed" });
    if (!event.body) return resp(400, { error: "Body vacío" });

    let payload: any;
    try { payload = JSON.parse(event.body); } catch { return resp(400, { error: "JSON inválido" }); }

    const federalNumber = String(payload?.federalNumber || "").trim();
    if (!federalNumber) return resp(400, { error: "federalNumber requerido" });
    if (!TOKEN) return resp(400, { error: "PIPEDRIVE_API_TOKEN no definido" });

    const detail = await fetchPipedriveJSON(`/deals/${encodeURIComponent(federalNumber)}`);
    if (!detail.ok) return resp(502, { error: "pipedrive_upstream_failed", attempts: detail.attempts });

    // ÉXITO (solo retorno; si quieres escribir a DB, lo añadimos después)
    return resp(200, { ok: true, host_used: detail.hostUsed, pipedrive: detail.json });
  } catch (e: any) {
    return resp(500, { error: String(e?.message || e) });
  }
};

function resp(code: number, data: unknown): Resp {
  return { statusCode: code, headers, body: JSON.stringify(data) };
}

async function fetchPipedriveJSON(path: string): Promise<{
  ok: boolean;
  hostUsed?: string;
  json?: any;
  attempts: Array<{ host: string; status: number; statusText: string; url: string; contentType: string | null; bodySnippet: string }>;
}> {
  const attempts: Array<{ host: string; status: number; statusText: string; url: string; contentType: string | null; bodySnippet: string }> = [];
  for (const host of HOSTS) {
    const sep = path.includes("?") ? "&" : "?";
    const rawUrl = `${host}${path}${sep}api_token=${encodeURIComponent(TOKEN)}`;

    try {
      const res  = await fetch(rawUrl, { headers: { Accept: "application/json" }, redirect: "follow" });
      const text = await res.text().catch(() => "");
      const ct   = res.headers.get("content-type");
      const masked = rawUrl.replace(/(api_token=)[^&]+/i, "$1***");
      const bodySnippet = (text || "").replace(/\s+/g, " ").trim().slice(0, 800);

      attempts.push({ host, status: res.status, statusText: res.statusText, url: masked, contentType: ct, bodySnippet });

      if (res.ok && ct && ct.toLowerCase().includes("application/json")) {
        try {
          const json = JSON.parse(text);
          return { ok: true, hostUsed: host, json, attempts };
        } catch {
          // sigue al siguiente host
        }
      }
    } catch (err: any) {
      attempts.push({ host, status: 0, statusText: String(err?.message || err), url: rawUrl.replace(/(api_token=)[^&]+/i, "$1***"), contentType: null, bodySnippet: "" });
    }
  }
  return { ok: false, attempts };
}
