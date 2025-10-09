// backend/functions/deal-sessions.ts
import { randomUUID } from "crypto";
import { getPrisma } from "./_shared/prisma";
import {
  errorResponse,
  preflightResponse,
  successResponse,
} from "./_shared/response";
import { toMadridISOString } from "./_shared/timezone";

const PLANIFICABLE_PREFIXES = ["form-", "pci-", "ces-", "prev-"];
const EXCLUDED_PREFIX = "ext-";

const VALID_STATUS = new Set(["Borrador", "Planificada", "Suspendido", "Cancelado"]);

type ExpandKey =
  | "deal_product"
  | "sala"
  | "formadores"
  | "unidades_moviles"
  | "resources";

type DealSessionRecord = {
  session_id: string;
  deal_id: string;
  deal_product_id: string | null;
  status: string;
  start_at: Date | string | null;
  end_at: Date | string | null;
  sala_id: string | null;
  direccion: string | null;
  sede: string | null;
  comentarios: string | null;
  origen: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  deal_product?: { id: string; code: string | null; hours: any } | null;
  sala?: { sala_id: string; name: string; sede: string | null } | null;
  trainers?: Array<{
    trainer_id: string;
    trainer: { trainer_id: string; name: string | null; activo: boolean } | null;
  }>;
  mobile_units?: Array<{
    unidad_id: string;
    unidad: {
      unidad_id: string;
      name: string;
      matricula: string;
      tipo: string[];
      sede: string[];
    } | null;
  }>;
};

function buildInclude(expand: Set<ExpandKey>) {
  const include: any = {};
  if (expand.has("deal_product") || expand.has("resources")) {
    include.deal_product = true;
  }
  if (expand.has("sala") || expand.has("resources")) {
    include.sala = true;
  }
  if (expand.has("formadores") || expand.has("resources")) {
    include.trainers = { include: { trainer: true } };
  }
  if (expand.has("unidades_moviles") || expand.has("resources")) {
    include.mobile_units = { include: { unidad: true } };
  }
  return include;
}

function parseSessionIdFromPath(path: string): string | null {
  const value = String(path || "");
  const match = value.match(/\/(?:\.netlify\/functions\/)?deal-sessions\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function parseExpand(raw: unknown): Set<ExpandKey> {
  if (!raw) return new Set();
  const text = Array.isArray(raw) ? raw.join(",") : String(raw);
  const items = text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as ExpandKey[];

  const set = new Set<ExpandKey>();
  for (const item of items) {
    if (
      item === "deal_product" ||
      item === "sala" ||
      item === "formadores" ||
      item === "unidades_moviles" ||
      item === "resources"
    ) {
      set.add(item);
    }
  }
  return set;
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as { toNumber?: () => number };
    if (typeof candidate.toNumber === "function") {
      const parsed = candidate.toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function mapSession(record: DealSessionRecord, expand: Set<ExpandKey>) {
  const includeResources = expand.has("resources");
  const includeDealProduct = includeResources || expand.has("deal_product");
  const includeSala = includeResources || expand.has("sala");
  const includeTrainers = includeResources || expand.has("formadores");
  const includeMobileUnits = includeResources || expand.has("unidades_moviles");

  return {
    session_id: record.session_id,
    deal_id: record.deal_id,
    deal_product_id: record.deal_product_id,
    deal_product:
      includeDealProduct && record.deal_product
        ? {
            id: record.deal_product.id,
            code: record.deal_product.code,
            hours: decimalToNumber(record.deal_product.hours),
          }
        : null,
    inicio: toMadridISOString(record.start_at),
    fin: toMadridISOString(record.end_at),
    sala_id: record.sala_id,
    sala:
      includeSala && record.sala
        ? {
            sala_id: record.sala.sala_id,
            name: record.sala.name,
            sede: record.sala.sede,
          }
        : null,
    formadores:
      includeTrainers && Array.isArray(record.trainers)
        ? record.trainers.map((entry) => ({
            trainer_id: entry.trainer_id,
            name: entry.trainer?.name ?? null,
            activo: entry.trainer?.activo ?? false,
          }))
        : [],
    unidades_moviles:
      includeMobileUnits && Array.isArray(record.mobile_units)
        ? record.mobile_units.map((entry) => ({
            unidad_id: entry.unidad_id,
            name: entry.unidad?.name ?? null,
            matricula: entry.unidad?.matricula ?? null,
            tipo: entry.unidad?.tipo ?? [],
            sede: entry.unidad?.sede ?? [],
          }))
        : [],
    direccion: record.direccion,
    sede: record.sede,
    comentarios: record.comentarios,
    estado: record.status,
    origen: {
      deal_product_id: record.deal_product_id,
      code:
        includeDealProduct && record.deal_product
          ? record.deal_product.code
          : record.origen,
    },
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  };
}

function isPlanificableProduct(codeRaw: unknown): boolean {
  if (typeof codeRaw !== "string") return false;
  const code = codeRaw.trim().toLowerCase();
  if (!code.length) return false;
  if (code.startsWith(EXCLUDED_PREFIX)) return false;
  return PLANIFICABLE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

function ensurePositiveInt(value: unknown): number {
  const parsed = decimalToNumber(value);
  if (parsed === null) return 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function parseDateInput(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") {
    return { value: null };
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return {
      error: errorResponse(
        "VALIDATION_ERROR",
        `El campo ${field} debe ser una fecha válida ISO-8601`,
        400
      ),
    };
  }
  return { value: date };
}

function normalizeStatusInput(value: unknown) {
  if (value === null || value === undefined) return null;
  const status = String(value).trim();
  if (!status.length) return null;
  const normalized =
    status === "borrador"
      ? "Borrador"
      : status === "planificada"
      ? "Planificada"
      : status === "suspendido"
      ? "Suspendido"
      : status === "cancelado"
      ? "Cancelado"
      : status;
  if (!VALID_STATUS.has(normalized)) {
    return {
      error: errorResponse(
        "VALIDATION_ERROR",
        "El campo estado contiene un valor no válido",
        400
      ),
    };
  }
  return { value: normalized };
}

async function syncSessionsForDeal(prisma: ReturnType<typeof getPrisma>, dealId: string) {
  const deal = await prisma.deals.findUnique({
    where: { deal_id: dealId },
    select: {
      deal_id: true,
      training_address: true,
      sede_label: true,
      deal_products: {
        select: { id: true, code: true, quantity: true, hours: true },
      },
    },
  });

  if (!deal) {
    return errorResponse("NOT_FOUND", "Deal no encontrado", 404);
  }

  const planificables = deal.deal_products.filter(
    (product: (typeof deal.deal_products)[number]) =>
      isPlanificableProduct(product.code)
  );

  if (!planificables.length) {
    const total = await prisma.deal_sessions.count({ where: { deal_id: dealId } });
    return successResponse({ created: 0, total });
  }

  const existing = await prisma.deal_sessions.findMany({
    where: { deal_id: dealId },
    select: { session_id: true, deal_product_id: true },
  });

  const existingCountByProduct = new Map<string, number>();
  for (const session of existing) {
    if (!session.deal_product_id) continue;
    existingCountByProduct.set(
      session.deal_product_id,
      (existingCountByProduct.get(session.deal_product_id) ?? 0) + 1
    );
  }

  const defaultDireccion = deal.training_address ?? null;
  const defaultSede = deal.sede_label ?? null;

  const creations: Array<{ [key: string]: any }> = [];

  for (const product of planificables) {
    const quantity = ensurePositiveInt(product.quantity);
    if (quantity <= 0) continue;

    const existingForProduct = existingCountByProduct.get(product.id) ?? 0;
    const missing = Math.max(0, quantity - existingForProduct);
    if (missing <= 0) continue;

    for (let i = 0; i < missing; i += 1) {
      creations.push({
        session_id: randomUUID(),
        deal_id: dealId,
        deal_product_id: product.id,
        direccion: defaultDireccion,
        sede: defaultSede,
        origen: product.code ?? null,
      });
    }
  }

  if (creations.length) {
    await prisma.deal_sessions.createMany({ data: creations, skipDuplicates: true });
  }

  const total = await prisma.deal_sessions.count({ where: { deal_id: dealId } });
  return successResponse({ created: creations.length, total });
}

async function handleUpdateSession(
  prisma: ReturnType<typeof getPrisma>,
  sessionId: string,
  body: any,
  expandRaw?: unknown
) {
  if (!body || typeof body !== "object") {
    return errorResponse("VALIDATION_ERROR", "Body inválido", 400);
  }

  const session = await prisma.deal_sessions.findUnique({
    where: { session_id: sessionId },
    include: {
      deal_product: { select: { id: true, hours: true } },
      trainers: { select: { trainer_id: true } },
    },
  });

  if (!session) {
    return errorResponse("NOT_FOUND", "Sesión no encontrada", 404);
  }

  const updateData: Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(body, "inicio")) {
    const result = parseDateInput(body.inicio, "inicio");
    if ("error" in result) return result.error;
    updateData.start_at = result.value;
  }

  let explicitFin = false;
  if (Object.prototype.hasOwnProperty.call(body, "fin")) {
    explicitFin = true;
    const result = parseDateInput(body.fin, "fin");
    if ("error" in result) return result.error;
    updateData.end_at = result.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "sala_id")) {
    const salaId = toNullableString(body.sala_id);
    if (salaId) {
      const salaExists = await prisma.salas.findUnique({
        where: { sala_id: salaId },
        select: { sala_id: true },
      });
      if (!salaExists) {
        return errorResponse("VALIDATION_ERROR", "La sala especificada no existe", 400);
      }
      updateData.sala_id = salaId;
    } else {
      updateData.sala_id = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "direccion")) {
    updateData.direccion = toNullableString(body.direccion);
  }

  if (Object.prototype.hasOwnProperty.call(body, "sede")) {
    updateData.sede = toNullableString(body.sede);
  }

  if (Object.prototype.hasOwnProperty.call(body, "comentarios")) {
    updateData.comentarios = toNullableString(body.comentarios);
  }

  const statusExplicitlyProvided = Object.prototype.hasOwnProperty.call(body, "estado");
  if (statusExplicitlyProvided) {
    const statusResult = normalizeStatusInput(body.estado);
    if (statusResult && "error" in statusResult) {
      return statusResult.error;
    }
    if (statusResult && "value" in statusResult) {
      updateData.status = statusResult.value;
    }
  }

  const trainerIdsRaw = Object.prototype.hasOwnProperty.call(body, "formadores")
    ? body.formadores
    : undefined;
  let trainerIdsForUpdate: string[] | null = null;
  const mobileUnitsRaw = Object.prototype.hasOwnProperty.call(
    body,
    "unidades_moviles"
  )
    ? body.unidades_moviles
    : undefined;

  if (
    updateData.start_at &&
    !explicitFin &&
    session.deal_product &&
    ensurePositiveInt(session.deal_product.hours) > 0
  ) {
    const hours = ensurePositiveInt(session.deal_product.hours);
    const milliseconds = hours * 60 * 60 * 1000;
    const start = updateData.start_at instanceof Date
      ? updateData.start_at
      : new Date(updateData.start_at);
    updateData.end_at = new Date(start.getTime() + milliseconds);
  }

  const operations: any[] = [];

  if (trainerIdsRaw !== undefined) {
    if (trainerIdsRaw === null) {
      operations.push(
        prisma.deal_session_trainers.deleteMany({ where: { session_id: sessionId } })
      );
      trainerIdsForUpdate = [];
    } else if (Array.isArray(trainerIdsRaw)) {
      const trainerIds = Array.from(
        new Set(
          trainerIdsRaw
            .map((id) => toNullableString(id))
            .filter((id): id is string => Boolean(id))
        )
      );

      if (trainerIds.length) {
        const trainers = await prisma.trainers.findMany({
          where: { trainer_id: { in: trainerIds }, activo: true },
          select: { trainer_id: true },
        });
        if (trainers.length !== trainerIds.length) {
          return errorResponse(
            "VALIDATION_ERROR",
            "Alguno de los formadores especificados no existe o no está activo",
            400
          );
        }
      }

      operations.push(
          prisma.deal_session_trainers.deleteMany({ where: { session_id: sessionId } })
      );

      if (trainerIds.length) {
        trainerIdsForUpdate = trainerIds;
        operations.push(
          prisma.deal_session_trainers.createMany({
            data: trainerIds.map((trainerId) => ({
              session_id: sessionId,
              trainer_id: trainerId,
            })),
          })
        );
      } else {
        trainerIdsForUpdate = [];
      }
    } else {
      return errorResponse(
        "VALIDATION_ERROR",
        "El campo formadores debe ser una lista de identificadores",
        400
      );
    }
  }

  if (mobileUnitsRaw !== undefined) {
    if (mobileUnitsRaw === null) {
      operations.push(
        prisma.deal_session_mobile_units.deleteMany({ where: { session_id: sessionId } })
      );
    } else if (Array.isArray(mobileUnitsRaw)) {
      const unitIds = Array.from(
        new Set(
          mobileUnitsRaw
            .map((id) => toNullableString(id))
            .filter((id): id is string => Boolean(id))
        )
      );

      if (unitIds.length) {
        const units = await prisma.unidades_moviles.findMany({
          where: { unidad_id: { in: unitIds } },
          select: { unidad_id: true },
        });
        if (units.length !== unitIds.length) {
          return errorResponse(
            "VALIDATION_ERROR",
            "Alguna de las unidades móviles especificadas no existe",
            400
          );
        }
      }

      operations.push(
        prisma.deal_session_mobile_units.deleteMany({ where: { session_id: sessionId } })
      );

      if (unitIds.length) {
        operations.push(
          prisma.deal_session_mobile_units.createMany({
            data: unitIds.map((unidadId) => ({
              session_id: sessionId,
              unidad_id: unidadId,
            })),
          })
        );
      }
    } else {
      return errorResponse(
        "VALIDATION_ERROR",
        "El campo unidades_moviles debe ser una lista de identificadores",
        400
      );
    }
  }

  const nextStart = Object.prototype.hasOwnProperty.call(updateData, "start_at")
    ? updateData.start_at
    : session.start_at;
  const nextEnd = Object.prototype.hasOwnProperty.call(updateData, "end_at")
    ? updateData.end_at
    : session.end_at;
  const nextSala = Object.prototype.hasOwnProperty.call(updateData, "sala_id")
    ? updateData.sala_id
    : session.sala_id;
  const nextDireccion = Object.prototype.hasOwnProperty.call(updateData, "direccion")
    ? updateData.direccion
    : session.direccion;
  const nextSede = Object.prototype.hasOwnProperty.call(updateData, "sede")
    ? updateData.sede
    : session.sede;
  const nextTrainerCount = trainerIdsForUpdate
    ? trainerIdsForUpdate.length
    : session.trainers?.length ?? 0;

  const requiredComplete = Boolean(
    nextStart &&
    nextEnd &&
    nextSala &&
    nextTrainerCount > 0 &&
    nextDireccion &&
    nextSede
  );

  if (statusExplicitlyProvided && updateData.status === "Planificada" && !requiredComplete) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Para marcar la sesión como Planificada deben completarse inicio, fin, sala, al menos un formador, dirección y sede",
      400
    );
  }

  if (
    !statusExplicitlyProvided &&
    session.status !== "Suspendido" &&
    session.status !== "Cancelado"
  ) {
    const autoStatus = requiredComplete ? "Planificada" : "Borrador";
    if (autoStatus !== session.status) {
      updateData.status = autoStatus;
    }
  }

  if (Object.keys(updateData).length) {
    operations.unshift(
      prisma.deal_sessions.update({
        where: { session_id: sessionId },
        data: updateData,
      })
    );
  }

  if (operations.length) {
    await prisma.$transaction(operations);
  }

  const expand = parseExpand(expandRaw);
  const include = buildInclude(expand);

  const updated = await prisma.deal_sessions.findUnique({
    where: { session_id: sessionId },
    include: Object.keys(include).length ? include : undefined,
  });

  if (!updated) {
    return errorResponse("NOT_FOUND", "Sesión no encontrada", 404);
  }

  return successResponse({ session: mapSession(updated as any, expand) });
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return preflightResponse();
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || "";
    const sessionIdFromPath = parseSessionIdFromPath(path);

    if (method === "GET" && !sessionIdFromPath) {
      const dealIdRaw = event.queryStringParameters?.dealId ?? event.queryStringParameters?.deal_id;
      const dealId = dealIdRaw ? String(dealIdRaw).trim() : "";
      if (!dealId.length) {
        return errorResponse("VALIDATION_ERROR", "Falta dealId", 400);
      }

      const expand = parseExpand(event.queryStringParameters?.expand);
      const statusFilterRaw =
        event.queryStringParameters?.estado ?? event.queryStringParameters?.status;
      const statusFilter = statusFilterRaw
        ? normalizeStatusInput(statusFilterRaw)
        : null;

      if (statusFilter && "error" in statusFilter) {
        return statusFilter.error;
      }

      const include = buildInclude(expand);

      const where: any = { deal_id: dealId };
      if (statusFilter && "value" in statusFilter) {
        where.status = statusFilter.value;
      }

      const sessions = await prisma.deal_sessions.findMany({
        where,
        include: Object.keys(include).length ? include : undefined,
        orderBy: [{ created_at: "asc" }],
      });

      return successResponse({
        sessions: sessions.map((session: any) => mapSession(session, expand)),
      });
    }

    if (method === "POST" && !sessionIdFromPath) {
      if (!event.body) {
        return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      }
      const body = JSON.parse(event.body || "{}");
      const dealId = toNullableString(body?.dealId ?? body?.deal_id);
      if (!dealId) {
        return errorResponse("VALIDATION_ERROR", "Falta dealId", 400);
      }

      return await syncSessionsForDeal(prisma, dealId);
    }

    if (method === "PATCH" && sessionIdFromPath) {
      if (!event.body) {
        return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      }
      const body = JSON.parse(event.body || "{}");
      const expandRaw = body.expand ?? event.queryStringParameters?.expand;
      return await handleUpdateSession(prisma, sessionIdFromPath, body, expandRaw);
    }

    if (method === "DELETE" && sessionIdFromPath) {
      const existing = await prisma.deal_sessions.findUnique({
        where: { session_id: sessionIdFromPath },
        select: { session_id: true },
      });
      if (!existing) {
        return errorResponse("NOT_FOUND", "Sesión no encontrada", 404);
      }

      await prisma.deal_sessions.delete({ where: { session_id: sessionIdFromPath } });
      return successResponse({ ok: true });
    }

    if (method === "GET" && sessionIdFromPath) {
      const expand = parseExpand(event.queryStringParameters?.expand);
      const include = buildInclude(expand);
      const session = await prisma.deal_sessions.findUnique({
        where: { session_id: sessionIdFromPath },
        include: Object.keys(include).length ? include : undefined,
      });

      if (!session) {
        return errorResponse("NOT_FOUND", "Sesión no encontrada", 404);
      }

      return successResponse({ session: mapSession(session as any, expand) });
    }

    return errorResponse("NOT_FOUND", "Ruta no encontrada", 404);
  } catch (error: any) {
    console.error("deal-sessions handler error", error);
    return errorResponse("INTERNAL_ERROR", "Error inesperado en deal-sessions", 500);
  }
};
