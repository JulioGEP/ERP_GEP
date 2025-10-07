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
  "training_address_label", // alias de entrada…
  "training_address",       // …campo real en BD
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

function resolvePipedriveId(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const v = (raw as any)?.value ?? (raw as any)?.id ?? null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resolvePipedriveName(deal: any): string | null {
  const direct = deal?.org_name ?? null;
  const nested = typeof deal?.org_id === "object" ? deal.org_id?.name ?? null : null;
  return (direct || nested || null) as string | null;
}

/** Normaliza un deal de Prisma para exponer `products`, `notes`, `documents` */
function mapDealForApi<T extends Record<string, any>>(deal: T | null): T | null {
  if (!deal) return deal;
  const out: any = { ...deal };

  if ("deal_products" in out) {
    out.products = out.deal_products;
    delete out.deal_products;
  }
  if ("deal_notes" in out) {
    out.notes = out.deal_notes;
    delete out.deal_notes;
  }
  if ("deal_files" in out) {
    out.documents = out.deal_files;
    delete out.deal_files;
  }

  return out as T;
}

/* ======================= IMPORT DESDE PIPEDRIVE ======================= */
async function importDealFromPipedrive(dealIdRaw: any) {
  const dealIdStr = String(dealIdRaw ?? "").trim();
  if (!dealIdStr) throw new Error("Falta dealId");
  const dealIdNum = Number(dealIdStr);
  if (!Number.isFinite(dealIdNum)) throw new Error("dealId inválido");

  // 1) Traer árbol completo desde Pipedrive
  const d = await getDeal(dealIdNum);
  if (!d) throw new Error("Deal no encontrado en Pipedrive");

  const orgId = resolvePipedriveId(d.org_id);
  const personId = resolvePipedriveId(d.person_id);

  const org = orgId ? await getOrganization(orgId) : null;
  const person = personId ? await getPerson(personId) : null;
  const [products, notes, files] = await Promise.all([
    getDealProducts(dealIdNum).then((x) => x ?? []),
    getDealNotes(dealIdNum).then((x) => x ?? []),
    getDealFiles(dealIdNum).then((x) => x ?? []),
  ]);

  // 2) Mapear + upsert relacional en Neon
  const savedDealId = await mapAndUpsertDealTree({
    deal: d,
    org: org || (orgId ? { id: orgId, name: resolvePipedriveName(d) ?? "—" } : undefined),
    person: person || (personId ? { id: personId } : undefined),
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
    const dealIdStr = parsePathId(path) ?? (qsId && qsId.length ? qsId : null);
    const dealId = dealIdStr !== null ? String(dealIdStr) : null;

    /* ------------ IMPORT: POST/GET /.netlify/functions/deals/import ------------ */
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
        const dealRaw = await prisma.deals.findUnique({
          where: { deal_id: String(deal_id) },
          include: {
            organization: { select: { org_id: true, name: true } },
            person: {
              select: {
                person_id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
              },
            },
            deal_products: true,
            deal_notes: true,
            deal_files: true,
          },
        });
        const deal = mapDealForApi(dealRaw);
        return successResponse({ ok: true, warnings, deal });
      } catch (e: any) {
        return errorResponse("IMPORT_ERROR", e?.message || "Error importando deal", 502);
      }
    }

    /* ------------------- GET detalle: /deals/:id o ?dealId= ------------------- */
    if (method === "GET" && dealId !== null) {
      const dealRaw = await prisma.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: { orderBy: { created_at: "asc" } },
          deal_notes: { orderBy: { created_at: "desc" } },
          deal_files: { orderBy: { created_at: "desc" } },
        },
      });
      if (!dealRaw) return errorResponse("NOT_FOUND", "Deal no encontrado", 404);

      const deal = mapDealForApi(dealRaw);
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

      // Normaliza alias de dirección de formación al campo real de BD
      if ("training_address_label" in patch && patch.training_address_label != null) {
        patch.training_address = patch.training_address_label;
        delete patch.training_address_label;
      }

      // Coerciones y validaciones
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

      const updatedRaw = await prisma.deals.findUnique({
        where: { deal_id: String(dealId) },
        include: {
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: { orderBy: { created_at: "asc" } },
          deal_notes: { orderBy: { created_at: "desc" } },
          deal_files: { orderBy: { created_at: "desc" } },
        },
      });

      const deal = mapDealForApi(updatedRaw);
      return successResponse({ ok: true, deal });
    }

    /* -------------- GET listado: /.netlify/functions/deals?noSessions=true -------------- */
    if (method === "GET" && event.queryStringParameters?.noSessions === "true") {
      // listamos deals + organización/persona + productos (sin sessions)
      const rowsRaw = await prisma.deals.findMany({
        select: {
          deal_id: true,
          title: true,
          sede_label: true,
          training_address: true,
          alumnos: true,
          caes_label: true,
          fundae_label: true,
          hotel_label: true,
          org_id: true,
          person_id: true,
          created_at: true,
          organization: { select: { org_id: true, name: true } },
          person: {
            select: {
              person_id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
          deal_products: {
            select: {
              id: true,
              name: true,
              code: true,
              quantity: true,
              price: true,
              type: true,
              hours: true,       // hours existe en deal_products
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const deals = rowsRaw.map((r) => mapDealForApi(r));
      return successResponse({ deals });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    const message = e?.message || "Unexpected";
    return errorResponse("UNEXPECTED", message, 500);
  }
};
