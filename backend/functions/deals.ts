// backend/functions/deals.ts
import { COMMON_HEADERS, successResponse, errorResponse } from "./_shared/response";
import { getPrisma } from "./_shared/prisma";
import {
  getDeal,
  getOrganization,
  getPerson,
  getDealProducts,
  getDealNotes,
  getDealFiles,
} from "./_shared/pipedrive";
import { mapAndUpsertDealTree } from "./_shared/mappers";

const EDITABLE_FIELDS = new Set([
  "sede_label",
  "hours",
  "training_address_label",
  "caes_label",
  "fundae_label",
  "hotel_label",
  "alumnos",
]);

/* -------------------- Helpers -------------------- */
function parsePathId(path: any): string | null {
  if (!path) return null;
  // admite .../deals/:id
  const m = String(path).match(/\/deals\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/* ======================= IMPORT DESDE PIPEDRIVE ======================= */
async function importDealFromPipedrive(dealIdRaw: any) {
  const dealId = String(dealIdRaw ?? "").trim();
  if (!dealId) throw new Error("Falta dealId");

  // 1) Traer árbol completo desde Pipedrive
  const d = await getDeal(Number(dealId));
  if (!d) throw new Error("Deal no encontrado en Pipedrive");

  const org = d.org_id ? await getOrganization(Number(d.org_id)) : null;
  const person = d.person_id ? await getPerson(Number(d.person_id)) : null;
  const [products, notes, files] = await Promise.all([
    getDealProducts(Number(dealId)).then((x) => x ?? []),
    getDealNotes(Number(dealId)).then((x) => x ?? []),
    getDealFiles(Number(dealId)).then((x) => x ?? []),
  ]);

  // 2) Mapear + upsert relacional en Neon
  const savedDealId = await mapAndUpsertDealTree({
    deal: d,
    org: org || { id: d.org_id, name: d.org_name ?? "—" },
    person: person || (d.person_id ? { id: d.person_id } : undefined),
    products,
    notes,
    files,
  });

  // 3) Avisos no bloqueantes (warnings)
  const warnings: string[] = [];
  if (!d.title) warnings.push("Falta título en el deal.");
  if (!d.pipeline_id) warnings.push("No se ha podido resolver el pipeline del deal.");
  if (!products?.length) warnings.push("El deal no tiene productos vinculados en Pipedrive.");

  return { deal_id: savedDealId, warnings };
}

/* ============================== HANDLER ============================== */
export const handler = async (event: any) => {
  try {
    // CORS
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: COMMON_HEADERS, body: "" };
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || "";

    // id por PATH o por QUERY (?dealId=)
    const qsId = event.queryStringParameters?.dealId
      ? String(event.queryStringParameters.dealId).trim()
      : null;
    const dealId = parsePathId(path) ?? (qsId && qsId.length ? qsId : null);

    /* ------------ IMPORT: POST/GET /.backend/functions/deals/import ------------ */
    if (
      (method === "POST" && path.endsWith("/deals/import")) ||
      (method === "GET" && path.endsWith("/deals/import"))
    ) {
      const body = event.body ? JSON.parse(event.body) : {};
      const incomingId =
        body?.dealId ?? body?.id ?? body?.deal_id ?? event.queryStringParameters?.dealId;
      if (!incomingId) return errorResponse("VALIDATION_ERROR", "Falta dealId", 400);

      try {
        const { deal_id, warnings } = await importDealFromPipedrive(incomingId);
        const deal = await prisma.deals.findUnique({
          where: { deal_id },
          include: {
            organization: { select: { org_id: true, name: true } },
            person: { select: { person_id: true, first_name: true, last_name: true, email: true, phone: true } },
            products: true,
            notes: true,
            documents: true,
          },
        });
        return successResponse({ ok: true, warnings, deal });
      } catch (e: any) {
        return errorResponse("IMPORT_ERROR", e?.message || "Error importando deal", 502);
      }
    }

    /* ------------------- GET detalle: /deals/:id o ?dealId= ------------------- */
    if (method === "GET" && dealId !== null) {
      const deal = await prisma.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: { select: { org_id: true, name: true } },
          person: { select: { person_id: true, first_name: true, last_name: true, email: true, phone: true } },
          products: { orderBy: { created_at: "asc" } },
          notes: { orderBy: { created_at: "desc" } },
          documents: { orderBy: { created_at: "desc" } },
        },
      });
      if (!deal) return errorResponse("NOT_FOUND", "Deal no encontrado", 404);

      return successResponse({ deal });
    }

    /* ---------------- PATCH (campos editables) ---------------- */
    if (method === "PATCH" && dealId !== null) {
      if (!event.body) return errorResponse("VALIDATION_ERROR", "Body requerido", 400);

      const body = JSON.parse(event.body || "{}");
      const patch: Record<string, any> = {};

      if (body.deal && typeof body.deal === "object") {
        for (const k of Object.keys(body.deal)) {
          if (EDITABLE_FIELDS.has(k)) patch[k] = body.deal[k];
        }
      }

      // Coerciones y validaciones
      if ("hours" in patch) {
        const v = patch.hours;
        const n = toIntOrNull(v);
        if (v !== null && v !== undefined && n === null) {
          return errorResponse("VALIDATION_ERROR", "hours inválido", 400);
        }
        patch.hours = n;
      }
      if ("alumnos" in patch) {
        const v = patch.alumnos;
        const n = toIntOrNull(v);
        if (v !== null && v !== undefined && n === null) {
          return errorResponse("VALIDATION_ERROR", "alumnos inválido", 400);
        }
        patch.alumnos = n;
      }

      if (Object.keys(patch).length) {
        await prisma.deals.update({
          where: { deal_id: String(dealId) },
          data: patch,
        });
      }

      const updated = await prisma.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: { select: { org_id: true, name: true } },
          person: { select: { person_id: true, first_name: true, last_name: true, email: true, phone: true } },
          products: { orderBy: { created_at: "asc" } },
          notes: { orderBy: { created_at: "desc" } },
          documents: { orderBy: { created_at: "desc" } },
        },
      });

      return successResponse({ ok: true, deal: updated });
    }

    /* -------------- GET listado: /.backend/functions/deals?noSessions=true -------------- */
    if (method === "GET" && event.queryStringParameters?.noSessions === "true") {
      // listamos deals + organización/persona + productos (sin seassons)
      const rows = await prisma.deals.findMany({
        select: {
          deal_id: true,
          title: true,
          sede_label: true,
          pipeline_label: true,
          training_address_label: true,
          hours: true,
          alumnos: true,
          caes_label: true,
          fundae_label: true,
          hotel_label: true,
          org_id: true,
          person_id: true,
          created_at: true,
          organization: { select: { org_id: true, name: true } },
          person: { select: { person_id: true, first_name: true, last_name: true, email: true, phone: true } },
          products: {
            select: { id: true, name: true, code: true, quantity: true, price: true, type: true, hours: true },
            orderBy: { created_at: "asc" },
          },
        },
        orderBy: { created_at: "desc" },
      });

      return successResponse({ deals: rows });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    const message = e?.message || "Unexpected";
    return errorResponse("UNEXPECTED", message, 500);
  }
};
