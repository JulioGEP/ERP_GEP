// backend/functions/deals.ts
import { COMMON_HEADERS, successResponse, errorResponse } from "./_shared/response";
import { getPrisma } from "./_shared/prisma";
import { nowInMadridISO, toMadridISOString } from "./_shared/timezone";
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

function normalizeProductId(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const id = String(raw).trim();
  return id.length ? id : null;
}

function parseProductHours(raw: any): { ok: boolean; value: number | null } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false, value: null };
    return { ok: true, value: Math.round(raw) };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.length) return { ok: true, value: null };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, value: null };
    return { ok: true, value: Math.round(parsed) };
  }
  return { ok: false, value: null };
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
function isHttpUrl(value?: unknown): boolean {
  if (!value) return false;
  try {
    const url = String(value);
    return /^https?:\/\//i.test(url);
  } catch {
    return false;
  }
}

function mapDealFileForApi(file: any) {
  if (!file) return file;
  const id = file.id != null ? String(file.id) : undefined;
  const rawUrl = typeof file.url === "string" ? file.url : null;
  const rawFileUrl = typeof file.file_url === "string" ? file.file_url : null;
  const isHttp = isHttpUrl(rawUrl ?? rawFileUrl);

  const createdAt = file.created_at ?? file.added_at ?? null;

  return {
    id,
    source: isHttp ? "PIPEDRIVE" : "S3",
    name: file.file_name ?? file.name ?? null,
    mime_type: file.file_type ?? file.mime_type ?? null,
    url: isHttp ? rawUrl ?? rawFileUrl ?? null : null,
    created_at: toMadridISOString(createdAt),
  };
}

function mapDealForApi<T extends Record<string, any>>(deal: T | null): T | null {
  if (!deal) return deal;
  const out: any = { ...deal };

  if ("created_at" in out) {
    out.created_at = toMadridISOString(out.created_at);
  }
  if ("updated_at" in out) {
    out.updated_at = toMadridISOString(out.updated_at);
  }

  if ("deal_products" in out) {
    out.products = Array.isArray(out.deal_products)
      ? out.deal_products.map((product: any) => ({
          ...product,
          created_at: toMadridISOString(product?.created_at ?? null),
          updated_at: toMadridISOString(product?.updated_at ?? null),
        }))
      : out.deal_products;
    delete out.deal_products;
  }
  if ("deal_notes" in out) {
    out.notes = Array.isArray(out.deal_notes)
      ? out.deal_notes.map((note: any) => ({
          ...note,
          created_at: toMadridISOString(note?.created_at ?? null),
          updated_at: toMadridISOString(note?.updated_at ?? null),
        }))
      : out.deal_notes;
    delete out.deal_notes;
  }
  if ("deal_files" in out) {
    out.documents = Array.isArray(out.deal_files)
      ? out.deal_files.map((file: any) => mapDealFileForApi(file))
      : out.deal_files;
    delete out.deal_files;
  }

  return out as T;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number | null,
  label?: string
): Promise<T> {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(
        label ? `${label} timed out after ${timeoutMs}ms` : `Timeout after ${timeoutMs}ms`
      );
      (err as any).code = "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }),
    timeoutPromise,
  ]);
}

/* ======================= IMPORT DESDE PIPEDRIVE ======================= */
async function importDealFromPipedrive(dealIdRaw: any) {
  const dealIdStr = String(dealIdRaw ?? "").trim();
  if (!dealIdStr) throw new Error("Falta dealId");
  const dealIdNum = Number(dealIdStr);
  if (!Number.isFinite(dealIdNum)) throw new Error("dealId inválido");

  const warnings: string[] = [];
  const timings = {
    getDealMs: 0,
    parallelFetchMs: 0,
    persistMs: 0,
    documentsSyncMs: 0,
  };
  const counters = {
    productsCount: 0,
    notesCount: 0,
    filesCount: 0,
  };
  let errorMessage: string | undefined;

  let d: any;
  let savedDealId: any;

  try {
    // 1) Traer árbol completo desde Pipedrive
    const getDealStart = Date.now();
    try {
      d = await getDeal(dealIdNum);
    } finally {
      timings.getDealMs = Date.now() - getDealStart;
    }
    if (!d) throw new Error("Deal no encontrado en Pipedrive");

    const orgId = resolvePipedriveId(d.org_id);
    const personId = resolvePipedriveId(d.person_id);

    const parallelTimeoutMs = Number(
      process.env.PIPEDRIVE_TIMEOUT_MS ?? process.env.PIPEDRIVE_FETCH_TIMEOUT_MS ?? null
    );

    const parallelStart = Date.now();
    const parallelSettled = await (async () => {
      const promises: [
        Promise<any>,
        Promise<any>,
        Promise<any[]>,
        Promise<any[]>,
        Promise<any[]>
      ] = [
        orgId ? getOrganization(orgId) : Promise.resolve(null),
        personId ? getPerson(personId) : Promise.resolve(null),
        getDealProducts(dealIdNum).then((x) => x ?? []),
        getDealNotes(dealIdNum).then((x) => x ?? []),
        getDealFiles(dealIdNum).then((x) => x ?? []),
      ];
      return withTimeout(Promise.allSettled(promises), parallelTimeoutMs, "parallelFetch");
    })().finally(() => {
      timings.parallelFetchMs = Date.now() - parallelStart;
    });

    const [orgRes, personRes, productsRes, notesRes, filesRes] = parallelSettled;

    const resolveErrorMessage = (reason: any) => {
      if (!reason) return "error desconocido";
      if (reason instanceof Error) return reason.message;
      return typeof reason === "string" ? reason : JSON.stringify(reason);
    };

    const org =
      orgRes.status === "fulfilled"
        ? orgRes.value
        : (() => {
            if (orgId) {
              warnings.push(
                `No se pudo obtener la organización desde Pipedrive (${resolveErrorMessage(
                  orgRes.reason
                )})`
              );
            }
            return null;
          })();

    const person =
      personRes.status === "fulfilled"
        ? personRes.value
        : (() => {
            if (personId) {
              warnings.push(
                `No se pudo obtener la persona desde Pipedrive (${resolveErrorMessage(
                  personRes.reason
                )})`
              );
            }
            return null;
          })();

    const productsFetchFailed = productsRes.status === "rejected";
    const products =
      productsRes.status === "fulfilled"
        ? Array.isArray(productsRes.value)
          ? productsRes.value
          : productsRes.value ?? []
        : [];
    if (productsFetchFailed) {
      warnings.push(
        `No se pudieron obtener los productos del deal (${resolveErrorMessage(productsRes.reason)})`
      );
    }

    const notesFetchFailed = notesRes.status === "rejected";
    const notes =
      notesRes.status === "fulfilled"
        ? Array.isArray(notesRes.value)
          ? notesRes.value
          : notesRes.value ?? []
        : [];
    if (notesFetchFailed) {
      warnings.push(
        `No se pudieron obtener las notas del deal (${resolveErrorMessage(notesRes.reason)})`
      );
    }

    const filesFetchFailed = filesRes.status === "rejected";
    const files =
      filesRes.status === "fulfilled"
        ? Array.isArray(filesRes.value)
          ? filesRes.value
          : filesRes.value ?? []
        : [];
    if (filesFetchFailed) {
      warnings.push(
        `No se pudieron obtener los archivos del deal (${resolveErrorMessage(filesRes.reason)})`
      );
    }

    counters.productsCount = Array.isArray(products) ? products.length : 0;
    counters.notesCount = Array.isArray(notes) ? notes.length : 0;
    counters.filesCount = Array.isArray(files) ? files.length : 0;

    // 2) Mapear + upsert relacional en Neon
    const persistStart = Date.now();
    try {
      savedDealId = await mapAndUpsertDealTree({
        deal: d,
        org: org || (orgId ? { id: orgId, name: resolvePipedriveName(d) ?? "—" } : undefined),
        person: person || (personId ? { id: personId } : undefined),
        products,
        notes,
        files,
      });
    } finally {
      timings.persistMs = Date.now() - persistStart;
    }

    // 3) Avisos no bloqueantes (warnings)
    if (!d.title) warnings.push("Falta título en el deal.");
    if (!d.pipeline_id) warnings.push("No se ha podido resolver el pipeline del deal.");
    if (!productsFetchFailed && !products?.length) {
      warnings.push("El deal no tiene productos vinculados en Pipedrive.");
    }

    return { deal_id: savedDealId, warnings };
  } catch (err: any) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const logPayload: Record<string, any> = {
      event: "deal-import-telemetry",
      dealId: dealIdNum,
      timings,
      counters,
    };
    if (errorMessage) {
      logPayload.error = errorMessage;
    }
    console.log(JSON.stringify(logPayload));
  }
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

    /* ---------------- ELIMINAR DEAL ---------------- */
    if (method === "DELETE" && dealId !== null) {
      const id = String(dealId);

      const existing = await prisma.deals.findUnique({
        where: { deal_id: id },
        select: { deal_id: true },
      });

      if (!existing) {
        return errorResponse("NOT_FOUND", "Deal no encontrado", 404);
      }

      await prisma.$transaction([
        prisma.deal_products.deleteMany({ where: { deal_id: id } }),
        prisma.deal_notes.deleteMany({ where: { deal_id: id } }),
        prisma.deal_files.deleteMany({ where: { deal_id: id } }),
        prisma.comments.deleteMany({ where: { deal_id: id } }),
        prisma.sessions.deleteMany({ where: { deal_id: id } }),
        prisma.deals.delete({ where: { deal_id: id } }),
      ]);

      return successResponse({ ok: true });
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

      const productPatches: Array<{ id: string; data: Record<string, any> }> = [];
      if (Array.isArray(body.products)) {
        for (const entry of body.products) {
          if (!entry || typeof entry !== "object") continue;
          const rawId = (entry as any).id ?? (entry as any).product_id;
          const productId = normalizeProductId(rawId);
          if (!productId) continue;

          const data: Record<string, any> = {};

          if (Object.prototype.hasOwnProperty.call(entry, "hours")) {
            const { ok, value } = parseProductHours((entry as any).hours);
            if (!ok) {
              return errorResponse("VALIDATION_ERROR", "hours inválido para producto", 400);
            }
            data.hours = value;
          }

          if (
            Object.prototype.hasOwnProperty.call(entry, "comments") ||
            Object.prototype.hasOwnProperty.call(entry, "product_comments")
          ) {
            const rawComment = (entry as any).comments ?? (entry as any).product_comments;
            if (rawComment === null || rawComment === undefined) {
              data.product_comments = null;
            } else {
              const commentStr = String(rawComment).trim();
              data.product_comments = commentStr.length ? commentStr : null;
            }
          }

          if (Object.keys(data).length) {
            productPatches.push({ id: productId, data });
          }
        }
      }

      if (Object.keys(patch).length) {
        await prisma.deals.update({
          where: { deal_id: String(dealId) },
          data: patch,
        });
      }

      if (productPatches.length) {
        const timestamp = nowInMadridISO();
        await Promise.all(
          productPatches.map((product) =>
            prisma.deal_products.updateMany({
              where: { id: product.id, deal_id: String(dealId) },
              data: { ...product.data, updated_at: timestamp },
            })
          )
        );
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
          transporte: true,
          po: true,
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

      const deals = rowsRaw.map((r: any) => mapDealForApi(r));
      return successResponse({ deals });
    }

    return errorResponse("NOT_IMPLEMENTED", "Ruta o método no soportado", 404);
  } catch (e: any) {
    const message = e?.message || "Unexpected";
    return errorResponse("UNEXPECTED", message, 500);
  }
};
