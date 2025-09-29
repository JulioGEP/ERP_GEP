const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const BUILD = `${process.env.COMMIT_REF || "local"}:${new Date().toISOString()}`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, kind: "diag", build: BUILD, path: event.rawUrl })
  };
};
