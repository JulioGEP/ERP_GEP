const COMMON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

const PIPEDRIVE_API_TOKEN = (process.env.PIPEDRIVE_API_TOKEN || "").trim();
const PIPEDRIVE_HOSTS = ["https://api.pipedrive.com/v1", "https://api-eu.pipedrive.com/v1"];

const DEAL_CUSTOM_FIELDS = {
  hours: "38f11c8876ecde803a027fbf3c9041fda2ae7eb7",
  sede: "676d6bd51e52999c582c01f67c99a35ed30bf6ae",
  caes: "e1971bf3a21d48737b682bf8d864ddc5eb15a351",
  fundae: "245d60d4d18aec40ba888998ef92e5d00e494583",
  hotelNight: "c3a6daf8eb5b4e59c3c07cda8e01f43439101269",
  trainingType: "pipeline_id"
};

function jsonResponse(statusCode, body) {
  return { statusCode, headers: COMMON_HEADERS, body: JSON.stringify(body) };
}

function maskToken(url) {
  return url.replace(/(api_token=)[^&]+/gi, "$1***");
}

async function callPipedrive(path) {
  const attempts = [];

  for (const host of PIPEDRIVE_HOSTS) {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${host}${path}${separator}api_token=${encodeURIComponent(PIPEDRIVE_API_TOKEN)}`;

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        redirect: "follow"
      });

      const text = await response.text().catch(() => "");
      const contentType = response.headers.get("content-type");
      const maskedUrl = maskToken(url);
      const bodySnippet = (text || "").replace(/\s+/g, " ").trim().slice(0, 800);

      attempts.push({
        host,
        status: response.status,
        statusText: response.statusText,
        url: maskedUrl,
        contentType,
        bodySnippet
      });

      if (response.ok && typeof contentType === "string" && contentType.toLowerCase().includes("application/json")) {
        try {
          return {
            ok: true,
            hostUsed: host,
            json: text ? JSON.parse(text) : null,
            attempts
          };
        } catch (error) {
          attempts.push({
            host,
            status: response.status,
            statusText: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
            url: maskedUrl,
            contentType,
            bodySnippet
          });
        }
      }
    } catch (error) {
      attempts.push({
        host,
        status: 0,
        statusText: error instanceof Error ? error.message : String(error),
        url: maskToken(url),
        contentType: null,
        bodySnippet: ""
      });
    }
  }

  return { ok: false, attempts };
}

function extractField(entity, key) {
  if (!entity) return null;
  const value = entity[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null && "value" in value) {
    return value.value ?? null;
  }
  return value;
}

function parseNumberLike(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sanitizeHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>(\r?\n)?/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function buildDealSummary({ deal, notes, files }) {
  if (!deal || typeof deal !== "object") {
    throw new Error("Respuesta de Pipedrive inválida: deal vacío");
  }

  const dealId = parseNumberLike(deal.id);
  if (!dealId) {
    throw new Error("Respuesta de Pipedrive inválida: falta id del deal");
  }

  const organization = deal.org_id;
  const clientName =
    (organization && typeof organization === "object" && organization !== null && organization.name) ||
    (typeof deal.org_name === "string" ? deal.org_name : "");

  const trainingProducts = ensureArray(deal.products).filter((product) => {
    const code = (product && typeof product.code === "string" ? product.code : "").toLowerCase();
    return code.startsWith("form-");
  });

  const trainingNames = trainingProducts
    .map((product) => (product && typeof product.name === "string" ? product.name.trim() : ""))
    .filter(Boolean);

  const documents = ensureArray(files)
    .map((file) => (file && typeof file.name === "string" ? file.name : null))
    .filter(Boolean);

  const notesList = ensureArray(notes)
    .map((note) => sanitizeHtml(note && note.content))
    .filter(Boolean);

  const summary = {
    dealId,
    title: typeof deal.title === "string" && deal.title.trim() ? deal.title.trim() : `Presupuesto ${dealId}`,
    clientName: clientName || "Cliente sin nombre",
    sede: (extractField(deal, DEAL_CUSTOM_FIELDS.sede) || "").toString().trim() || "—"
  };

  const trainingTypeRaw = extractField(deal, DEAL_CUSTOM_FIELDS.trainingType);
  const hoursRaw = parseNumberLike(extractField(deal, DEAL_CUSTOM_FIELDS.hours));
  const caesRaw = extractField(deal, DEAL_CUSTOM_FIELDS.caes);
  const fundaeRaw = extractField(deal, DEAL_CUSTOM_FIELDS.fundae);
  const hotelNightRaw = extractField(deal, DEAL_CUSTOM_FIELDS.hotelNight);

  if (trainingNames.length) summary.trainingNames = trainingNames;
  if (trainingTypeRaw !== null && trainingTypeRaw !== undefined && String(trainingTypeRaw).trim()) {
    summary.trainingType = String(trainingTypeRaw).trim();
  }
  if (hoursRaw !== null) summary.hours = hoursRaw;
  if (caesRaw !== null && caesRaw !== undefined && String(caesRaw).trim()) {
    summary.caes = String(caesRaw).trim();
  }
  if (fundaeRaw !== null && fundaeRaw !== undefined && String(fundaeRaw).trim()) {
    summary.fundae = String(fundaeRaw).trim();
  }
  if (hotelNightRaw !== null && hotelNightRaw !== undefined && String(hotelNightRaw).trim()) {
    summary.hotelNight = String(hotelNightRaw).trim();
  }
  if (documents.length) summary.documents = documents;
  if (notesList.length) summary.notes = notesList;

  return summary;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(204, "");
  }

  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method Not Allowed" });
    }

    if (!event.body) {
      return jsonResponse(400, { error: "Body vacío" });
    }

    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch (error) {
      return jsonResponse(400, { error: "JSON inválido" });
    }

    const federalNumber = String(payload && payload.federalNumber ? payload.federalNumber : "").trim();
    if (!federalNumber) {
      return jsonResponse(400, { error: "federalNumber requerido" });
    }

    if (!PIPEDRIVE_API_TOKEN) {
      return jsonResponse(400, { error: "PIPEDRIVE_API_TOKEN no definido" });
    }

    const dealResult = await callPipedrive(`/deals/${encodeURIComponent(federalNumber)}?include_products=1`);
    if (!dealResult.ok) {
      return jsonResponse(502, { error: "pipedrive_upstream_failed", attempts: dealResult.attempts });
    }

    const dealPayload = dealResult.json;
    const dealData = dealPayload && typeof dealPayload === "object" ? dealPayload.data : null;
    if (!dealData) {
      return jsonResponse(404, { error: "No se ha encontrado el presupuesto solicitado en Pipedrive." });
    }

    const dealId = dealData.id;

    const [notesResult, filesResult] = await Promise.all([
      callPipedrive(`/deals/${encodeURIComponent(dealId)}/notes`),
      callPipedrive(`/deals/${encodeURIComponent(dealId)}/files`)
    ]);

    const notes = notesResult.ok && notesResult.json && Array.isArray(notesResult.json.data)
      ? notesResult.json.data
      : [];
    const files = filesResult.ok && filesResult.json && Array.isArray(filesResult.json.data)
      ? filesResult.json.data
      : [];

    const summary = buildDealSummary({ deal: dealData, notes, files });

    return jsonResponse(200, {
      ok: true,
      host_used: dealResult.hostUsed,
      deal: summary
    });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) });
  }
};
