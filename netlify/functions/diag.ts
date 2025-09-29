// /.netlify/functions/diag
type Event = { httpMethod: string; rawUrl: string };
type Resp  = { statusCode: number; headers: Record<string,string>; body: string };

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const BUILD = `${process.env.COMMIT_REF || "local"}:${new Date().toISOString()}`;

export const handler = async (event: Event): Promise<Resp> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, kind: "diag", build: BUILD, path: event.rawUrl })
  };
};
