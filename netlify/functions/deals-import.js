const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const TOKEN = (process.env.PIPEDRIVE_API_TOKEN || "").trim();
const HOSTS = ["https://api.pipedrive.com/v1", "https://api-eu.pipedrive.com/v1"]; // fallback EU

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    if (event.httpMethod !== "POST") return resp(405, { error: "Method Not Allowed" });
    if (!event.body) return resp(400, { error: "Body vacío" });

    let payload;
    try { payload = JSON.parse(event.body); } catch { return resp(400, { error: "JSON inválido" }); }

    const federalNumber = String(payload?.federalNumber || "").trim();
    if (!federalNumber) return resp(400, { error: "federalNumber requerido" });
    if (!TOKEN) return resp(400, { error: "PIPEDRIVE_API_TOKEN no definido" });

    const detail = await fetchPipedriveJSON(`/deals/${encodeURIComponent(federalNumber)}`);
    if (!detail.ok) return resp(502, { error: "pipedrive_upstream_failed", attempts: detail.attempts });

    // Éxito: devolvemos lo que respondió Pipedrive (JSON) + host usado
    return resp(200, { ok: true, host_used: detail.hostUsed, pipedrive: detail.json });
  } catch (e) {
    return resp(500, { error: String(e && e.message ? e.message : e) });
  }
};

function resp(code, data) {
  return { statusCode: code, headers, body: JSON.stringify(data) };
}

async function fetchPipedriveJSON(path) {
  const attempts = [];
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
          // probar siguiente host
        }
      }
    } catch (err) {
      attempts.push({ host, status: 0, statusText: String(err && err.message ? err.message : err), url: rawUrl.replace(/(api_token=)[^&]+/i, "$1***"), contentType: null, bodySnippet: "" });
    }
  }
  return { ok: false, attempts };
}
