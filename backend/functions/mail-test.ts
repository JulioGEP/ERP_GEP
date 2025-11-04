import type { Handler } from "@netlify/functions";
import { sendGmail } from "./_shared/googleJwt";

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: cors(),
      body: "",
    };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors(),
      body: "Method Not Allowed",
    };
  }

  try {
    const { to, subject, html } = JSON.parse(event.body || "{}");
    if (!to) {
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({ ok: false, error: "to required" }),
      };
    }

    const id = await sendGmail({
      to,
      subject: subject || `TEST ERP (${new Date().toISOString()})`,
      html: html || `<p>Hola, este es un test de envío Gmail API</p>`,
    });

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (e: any) {
    const detail = e?.response?.data ?? e?.message ?? e;
    console.error("[mail-test] error:", detail);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ ok: false, detail }),
    };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-cache",
  };
}
