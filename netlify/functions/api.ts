// netlify/functions/api.ts  — versión DIAGNÓSTICO
// Endpoints:
//   GET  /.netlify/functions/api/health
//   POST /.netlify/functions/api/deals/import  { federalNumber: string }

type HandlerEvent = {
  httpMethod: string;
  rawUrl: string;
  body: string | null;
};
type HandlerResponse = { statusCode: number; headers?: Record<string,string>; body: string };

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN?.trim() || "";

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: JSON_HEADERS, body: "" };

  try {
    const url = new URL(event.rawUrl);
    const pathname = url.pathname
      .replace(/^\/\.netlify\/functions\/api/, "")
      .replace(/^\/api/, "");

    if (pathname === "/health") {
      return json(200, {
        ok: true,
        env: {
          pipedrive_api_token: PIPEDRIVE_API_TOKEN ? "present" : "missing",
          database_url: process.env.DATABASE_URL ? "present" : "missing",
        },
        path: url.pathname,
      });
    }

    if (pathname === "/deals/import") {
      if (event.httpMethod !== "POST") return methodNotAllowed();
      if (!event.body) return badRequest("Body vacío");

      let payload: any;
      try { payload = JSON.parse(event.body); } catch { return badRequest("JSON inválido"); }

      const federalNumber = String(payload?.federalNumber || "").trim();
      if (!federalNumber) return badRequest("federalNumber requerido");
      if (!PIPEDRIVE_API_TOKEN) return badRequest("PIPEDRIVE_API_TOKEN no definido");

      const apiUrl = `https://api.pipedrive.com/v1/deals/${encodeURIComponent(federalNumber)}?api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`;

      const upstream = await fetch(apiUrl, { headers: { Accept: "application/json" } });
      const text = await upstream.text().catch(() => "");
      const masked = apiUrl.replace(/(api_token=)[^&]+/i, "$1***");

      // Devolvemos SIEMPRE diagnóstico claro, sin intentar JSON.parse
      return json(200, {
        upstream_status: upstream.status,
        upstream_status_text: upstream.statusText,
        url_called: masked,
        body_snippet: (text || "").replace(/\s+/g, " ").trim().slice(0, 800)
      });
    }

    return notFound("Ruta no encontrada");
  } catch (err: any) {
    return json(500, { error: String(err?.message || err) });
  }
};

// Helpers
function json(code:number, data:unknown):HandlerResponse { return { statusCode: code, headers: JSON_HEADERS, body: JSON.stringify(data) }; }
function badRequest(msg:string){ return json(400, { error: msg }); }
function notFound(msg:string){ return json(404, { error: msg }); }
function methodNotAllowed(){ return { statusCode: 405, headers: JSON_HEADERS, body: "" }; }
