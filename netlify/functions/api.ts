// netlify/functions/api.ts — DIAGNÓSTICO
// GET  /.netlify/functions/api/diag
// GET  /.netlify/functions/api/health
// POST /.netlify/functions/api/deals/import  { federalNumber: string }

type HandlerEvent = { httpMethod: string; rawUrl: string; body: string | null };
type HandlerResponse = { statusCode: number; headers?: Record<string,string>; body: string };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const BUILD = new Date().toISOString();
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN?.trim() || "";
const HOSTS = ["https://api.pipedrive.com/v1", "https://api-eu.pipedrive.com/v1"]; // fallback EU

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };

  try {
    const url = new URL(event.rawUrl);
    const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "");

    if (path === "/diag") {
      return json(200, { ok:true, kind:"diag", build:BUILD, path:url.pathname });
    }

    if (path === "/health") {
      return json(200, {
        ok: true,
        build: BUILD,
        env: {
          pipedrive_api_token: PIPEDRIVE_API_TOKEN ? "present" : "missing",
          database_url: process.env.DATABASE_URL ? "present" : "missing"
        },
        path: url.pathname
      });
    }

    if (path === "/deals/import") {
      if (event.httpMethod !== "POST") return methodNotAllowed();
      if (!event.body) return badRequest("Body vacío");
      let payload:any; try { payload = JSON.parse(event.body) } catch { return badRequest("JSON inválido"); }
      const federalNumber = String(payload?.federalNumber || "").trim();
      if (!federalNumber) return badRequest("federalNumber requerido");
      if (!PIPEDRIVE_API_TOKEN) return badRequest("PIPEDRIVE_API_TOKEN no definido");

      const detail = await fetchPipedriveJSON(`/deals/${encodeURIComponent(federalNumber)}`);
      if (!detail.ok) return json(502, { error:"pipedrive_upstream_failed", attempts: detail.attempts });

      // ÉXITO: devolvemos lo que nos da Pipedrive (sin DB, puro diagnóstico)
      return json(200, { ok:true, host_used: detail.hostUsed, pipedrive: detail.json });
    }

    return notFound("Ruta no encontrada");
  } catch (e:any) {
    return json(500, { error: String(e?.message || e) });
  }
};

async function fetchPipedriveJSON(path:string) : Promise<{
  ok:boolean; hostUsed?:string; json?:any;
  attempts:Array<{host:string; status:number; statusText:string; url:string; contentType:string|null; bodySnippet:string;}>;
}> {
  const attempts:any[] = [];
  for (const host of HOSTS) {
    const sep = path.includes("?") ? "&" : "?";
    const rawUrl = `${host}${path}${sep}api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`;
    try {
      const res = await fetch(rawUrl, { headers:{Accept:"application/json"}, redirect:"follow" });
      const text = await res.text().catch(()=> "");
      const ct = res.headers.get("content-type");
      const masked = rawUrl.replace(/(api_token=)[^&]+/i, "$1***");
      const bodySnippet = (text||"").replace(/\s+/g," ").trim().slice(0, 800);
      attempts.push({ host, status: res.status, statusText: res.statusText, url: masked, contentType: ct, bodySnippet });
      if (res.ok && ct && ct.toLowerCase().includes("application/json")) {
        try {
          const json = JSON.parse(text);
          return { ok:true, hostUsed:host, json, attempts };
        } catch {/* prueba siguiente host */}
      }
    } catch (err:any) {
      attempts.push({ host, status:0, statusText:String(err?.message||err), url: rawUrl.replace(/(api_token=)[^&]+/i,"$1***"), contentType:null, bodySnippet:"" });
    }
  }
  return { ok:false, attempts };
}

// --- helpers http ---
function json(code:number, data:unknown):HandlerResponse { return { statusCode:code, headers:JSON_HEADERS, body: JSON.stringify(data) }; }
function badRequest(msg:string){ return json(400,{error:msg}); }
function notFound(msg:string){ return json(404,{error:msg}); }
function methodNotAllowed(){ return { statusCode:405, headers:JSON_HEADERS, body:"" }; }
