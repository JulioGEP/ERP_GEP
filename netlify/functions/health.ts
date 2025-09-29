// /.netlify/functions/health
type Event = { httpMethod: string; rawUrl: string };
type Resp  = { statusCode: number; headers: Record<string,string>; body: string };

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export const handler = async (event: Event): Promise<Resp> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      env: {
        pipedrive_api_token: process.env.PIPEDRIVE_API_TOKEN ? "present" : "missing",
        database_url: process.env.DATABASE_URL ? "present" : "missing"
      },
      path: event.rawUrl,
      ts: Date.now()
    })
  };
};
