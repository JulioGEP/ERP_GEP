// backend/functions/deal-sessions.ts
import { randomUUID } from "crypto";
import { getPrisma } from "./_shared/prisma";
import {
  errorResponse,
  preflightResponse,
  successResponse,
} from "./_shared/response";
import { toMadridISOString } from "./_shared/timezone";
import {
  findMobileUnitsConflicts,
  findRoomsConflicts,
  findTrainersConflicts,
  type ResourceConflictSummary,
} from "./_lib/resource-conflicts";

const PLANIFICABLE_PREFIXES = ["form-", "pci-", "ces-", "prev-"];
const EXCLUDED_PREFIX = "ext-";

const VALID_STATUS = new Set(["Borrador", "Planificada", "Suspendido", "Cancelado"]);

let ensureDealSessionsPromise: Promise<void> | null = null;

type ExpandKey =
  | "deal_product"
  | "sala"
  | "formadores"
  | "unidades_moviles"
  | "resources";

type PlanificableProduct = {
  id: string;
  code: string | null;
  quantity: any;
  hours: any;
};

type ExistingSessionInfo = {
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
  created_at: Date | string | null;
  trainers?: Array<{ trainer_id: string }>;
  mobile_units?: Array<{ unidad_id: string }>;
};

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

function normalizeLegacyStatus(value: unknown): string {
  if (typeof value !== "string") return "Borrador";
  const normalized = value.trim();
  if (!normalized.length) return "Borrador";
  const upper = normalized.toUpperCase();
  if (upper === "PLANIFICADA" || upper === "PLANIFICADO") return "Planificada";
  if (upper === "BORRADOR") return "Borrador";
  if (upper === "SUSPENDIDO" || upper === "SUSPENDIDA") return "Suspendido";
  if (upper === "CANCELADO" || upper === "CANCELADA") return "Cancelado";
  return VALID_STATUS.has(normalized) ? normalized : "Borrador";
}

function parseLegacyDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLegacyIdList(value: unknown): string[] {
  if (!value) return [];
  const addUnique = (acc: string[], entry: unknown) => {
    if (entry === null || entry === undefined) return acc;
    const text = typeof entry === "string" ? entry.trim() : String(entry).trim();
    if (text.length && !acc.includes(text)) acc.push(text);
    return acc;
  };

  if (Array.isArray(value)) {
    return value.reduce<string[]>((acc, entry) => addUnique(acc, entry), []);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.reduce<string[]>((acc, entry) => addUnique(acc, entry), []);
      }
    } catch {
      /* ignore */
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length)
      .reduce<string[]>((acc, entry) => addUnique(acc, entry), []);
  }

  return addUnique([], value);
}

async function createDealSessionsTables(prisma: ReturnType<typeof getPrisma>) {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_session_status') THEN
        CREATE TYPE "deal_session_status" AS ENUM ('Borrador', 'Planificada', 'Suspendido', 'Cancelado');
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "deal_sessions" (
      "session_id" TEXT PRIMARY KEY,
      "deal_id" TEXT NOT NULL,
      "deal_product_id" TEXT,
      "status" "deal_session_status" NOT NULL DEFAULT 'Borrador',
      "start_at" TIMESTAMPTZ(6),
      "end_at" TIMESTAMPTZ(6),
      "sala_id" UUID,
      "direccion" TEXT,
      "sede" TEXT,
      "comentarios" TEXT,
      "origen" TEXT,
      "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_deal_sessions_deal_id" ON "deal_sessions" ("deal_id")'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_deal_sessions_deal_product_id" ON "deal_sessions" ("deal_product_id")'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_deal_sessions_sala_id" ON "deal_sessions" ("sala_id")'
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "deal_session_trainers" (
      "session_id" TEXT NOT NULL,
      "trainer_id" TEXT NOT NULL,
      "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "deal_session_trainers_pkey" PRIMARY KEY ("session_id", "trainer_id")
    );
  `);

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_deal_session_trainers_trainer_id" ON "deal_session_trainers" ("trainer_id")'
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "deal_session_mobile_units" (
      "session_id" TEXT NOT NULL,
      "unidad_id" TEXT NOT NULL,
      "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "deal_session_mobile_units_pkey" PRIMARY KEY ("session_id", "unidad_id")
    );
  `);

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_deal_session_mobile_units_unidad_id" ON "deal_session_mobile_units" ("unidad_id")'
  );

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_sessions_deal_fk') THEN
        ALTER TABLE "deal_sessions"
        ADD CONSTRAINT "deal_sessions_deal_fk" FOREIGN KEY ("deal_id") REFERENCES "deals" ("deal_id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_sessions_deal_product_fk') THEN
        ALTER TABLE "deal_sessions"
        ADD CONSTRAINT "deal_sessions_deal_product_fk" FOREIGN KEY ("deal_product_id") REFERENCES "deal_products" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_sessions_sala_fk') THEN
        ALTER TABLE "deal_sessions"
        ADD CONSTRAINT "deal_sessions_sala_fk" FOREIGN KEY ("sala_id") REFERENCES "salas" ("sala_id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_session_trainers_session_fk') THEN
        ALTER TABLE "deal_session_trainers"
        ADD CONSTRAINT "deal_session_trainers_session_fk" FOREIGN KEY ("session_id") REFERENCES "deal_sessions" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_session_trainers_trainer_fk') THEN
        ALTER TABLE "deal_session_trainers"
        ADD CONSTRAINT "deal_session_trainers_trainer_fk" FOREIGN KEY ("trainer_id") REFERENCES "trainers" ("trainer_id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_session_mobile_units_session_fk') THEN
        ALTER TABLE "deal_session_mobile_units"
        ADD CONSTRAINT "deal_session_mobile_units_session_fk" FOREIGN KEY ("session_id") REFERENCES "deal_sessions" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_session_mobile_units_unidad_fk') THEN
        ALTER TABLE "deal_session_mobile_units"
        ADD CONSTRAINT "deal_session_mobile_units_unidad_fk" FOREIGN KEY ("unidad_id") REFERENCES "unidades_moviles" ("unidad_id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
}

async function ensureDealSessionsSchema(prisma: ReturnType<typeof getPrisma>) {
  if (!ensureDealSessionsPromise) {
    ensureDealSessionsPromise = (async () => {
      const [dealSessionsExists = { exists: false }] = await prisma.$queryRawUnsafe<
        Array<{ exists: boolean }>
      >(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'deal_sessions'
        ) AS exists;
      `);

      if (dealSessionsExists?.exists) {
        return;
      }

      await createDealSessionsTables(prisma);

      const [legacyExists = { exists: false }] = await prisma.$queryRawUnsafe<
        Array<{ exists: boolean }>
      >(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'seassons'
        ) AS exists;
      `);

      if (!legacyExists?.exists) {
        return;
      }

      const legacyRows = (await prisma.$queryRawUnsafe<
        Array<{ data: Record<string, any> | null }>
      >(`
        SELECT row_to_json(s) AS data FROM seassons s;
      `)) ?? [];

      for (const row of legacyRows) {
        const record = row?.data ?? {};
        const sessionId = toNullableString(
          (record as any).session_id ?? (record as any).seasson_id
        );
        const dealId = toNullableString((record as any).deal_id);
        if (!sessionId || !dealId) {
          continue;
        }

        const createdAt = parseLegacyDate((record as any).created_at) ?? new Date();
        const updatedAt = parseLegacyDate((record as any).updated_at) ?? createdAt;
        const startAt = parseLegacyDate((record as any).date_start ?? (record as any).start_at);
        const endAt = parseLegacyDate((record as any).date_end ?? (record as any).end_at);
        const status = normalizeLegacyStatus((record as any).status);
        const salaId = toNullableString((record as any).sala_id);
        const direccion = toNullableString(
          (record as any).seasson_address ?? (record as any).direccion
        );
        const sede = toNullableString((record as any).sede);
        const comentarios = toNullableString(
          (record as any).comment_seasson ?? (record as any).comentarios
        );
        const dealProductId = toNullableString((record as any).deal_product_id);
        const origen = toNullableString((record as any).deal_product_code ?? (record as any).origen);

        await prisma.deal_sessions.upsert({
          where: { session_id: sessionId },
          create: {
            session_id: sessionId,
            deal_id: dealId,
            deal_product_id: dealProductId,
            status,
            start_at: startAt,
            end_at: endAt,
            sala_id: salaId,
            direccion,
            sede,
            comentarios,
            origen,
            created_at: createdAt,
            updated_at: updatedAt,
          },
          update: {
            deal_id: dealId,
            deal_product_id: dealProductId,
            status,
            start_at: startAt,
            end_at: endAt,
            sala_id: salaId,
            direccion,
            sede,
            comentarios,
            origen,
          },
        });

        const trainerIds = parseLegacyIdList(
          (record as any).seasson_fireman ?? (record as any).trainerIds
        );
        if (trainerIds.length) {
          await prisma.deal_session_trainers.createMany({
            data: trainerIds.map((trainerId) => ({
              session_id: sessionId,
              trainer_id: trainerId,
            })),
            skipDuplicates: true,
          });
        }

        const mobileUnitIds = parseLegacyIdList(
          (record as any).seasson_vehicle ?? (record as any).mobileUnitIds
        );
        if (mobileUnitIds.length) {
          await prisma.deal_session_mobile_units.createMany({
            data: mobileUnitIds.map((unidadId) => ({
              session_id: sessionId,
              unidad_id: unidadId,
            })),
            skipDuplicates: true,
          });
        }
      }
    })().catch((error) => {
      ensureDealSessionsPromise = null;
      throw error;
    });
  }

  return ensureDealSessionsPromise ?? Promise.resolve();
}

function formatRangeForMessage(startIso: string | null, endIso: string | null) {
  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  };

  const startText = formatDate(startIso);
  const endText = formatDate(endIso);

  if (startText && endText) {
    return `${startText} – ${endText}`;
  }
  return startText ?? endText ?? null;
}

function toComparableTimestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function isSessionEmpty(record: {
  start_at: Date | string | null;
  end_at: Date | string | null;
  sala_id: string | null;
  direccion: string | null;
  comentarios: string | null;
  trainers?: Array<{ trainer_id: string }>;
  mobile_units?: Array<{ unidad_id: string }>;
}) {
  const hasStart = !!record.start_at;
  const hasEnd = !!record.end_at;
  const hasRoom = typeof record.sala_id === "string" && record.sala_id.trim().length > 0;
  const hasDireccion = typeof record.direccion === "string" && record.direccion.trim().length > 0;
  const hasComentarios = typeof record.comentarios === "string" && record.comentarios.trim().length > 0;
  const hasTrainers = Array.isArray(record.trainers) && record.trainers.length > 0;
  const hasMobileUnits =
    Array.isArray(record.mobile_units) && record.mobile_units.length > 0;

  return !(
    hasStart ||
    hasEnd ||
    hasRoom ||
    hasDireccion ||
    hasComentarios ||
    hasTrainers ||
    hasMobileUnits
  );
}

function compareSessionsByCreated(a: ExistingSessionInfo, b: ExistingSessionInfo) {
  const diff = toComparableTimestamp(a.created_at) - toComparableTimestamp(b.created_at);
  if (diff !== 0) return diff;
  return a.session_id.localeCompare(b.session_id);
}

function assessProductSessions(
  requiredQuantity: number,
  sessions: ExistingSessionInfo[]
) {
  const ordered = [...sessions].sort(compareSessionsByCreated);
  const emptySessions = ordered.filter((session) => isSessionEmpty(session));
  const emptyIds = emptySessions.map((session) => session.session_id);

  let remainingExcess = Math.max(0, ordered.length - requiredQuantity);
  const deletableIds: string[] = [];

  if (remainingExcess > 0 && emptySessions.length > 0) {
    for (let index = emptySessions.length - 1; index >= 0 && remainingExcess > 0; index -= 1) {
      deletableIds.push(emptySessions[index]!.session_id);
      remainingExcess -= 1;
    }
  }

  const remaining = ordered.filter((session) => !deletableIds.includes(session.session_id));
  const flaggedCount = Math.max(0, remaining.length - requiredQuantity);
  const flaggedIds: string[] = [];

  if (flaggedCount > 0) {
    for (let offset = 0; offset < flaggedCount; offset += 1) {
      const session = remaining[remaining.length - 1 - offset]!;
      flaggedIds.push(session.session_id);
    }
  }

  const missingCount = Math.max(0, requiredQuantity - remaining.length);

  return { deletableIds, flaggedIds, emptyIds, missingCount };
}

function mapSession(
  record: DealSessionRecord,
  expand: Set<ExpandKey>,
  metadata?: { exceeding?: Set<string>; empty?: Set<string> }
) {
  const includeResources = expand.has("resources");
  const includeDealProduct = includeResources || expand.has("deal_product");
  const includeSala = includeResources || expand.has("sala");
  const includeTrainers = includeResources || expand.has("formadores");
  const includeMobileUnits = includeResources || expand.has("unidades_moviles");
  const isEmpty = metadata?.empty?.has(record.session_id) ?? isSessionEmpty(record);
  const isExceeding = metadata?.exceeding?.has(record.session_id) ?? false;

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
    is_empty,
    is_exceeding_quantity: isExceeding,
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

async function loadPlanningContext(
  prisma: ReturnType<typeof getPrisma>,
  dealId: string
) {
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
    return null;
  }

  const planificables = deal.deal_products.filter((product: PlanificableProduct) =>
    isPlanificableProduct(product.code)
  );

  return {
    planificables,
    defaultDireccion: deal.training_address ?? null,
    defaultSede: deal.sede_label ?? null,
  };
}

async function fetchExistingSessions(
  prisma: ReturnType<typeof getPrisma>,
  dealId: string
): Promise<ExistingSessionInfo[]> {
  const sessions = await prisma.deal_sessions.findMany({
    where: { deal_id: dealId },
    select: {
      session_id: true,
      deal_id: true,
      deal_product_id: true,
      status: true,
      start_at: true,
      end_at: true,
      sala_id: true,
      direccion: true,
      sede: true,
      comentarios: true,
      created_at: true,
      trainers: { select: { trainer_id: true } },
      mobile_units: { select: { unidad_id: true } },
    },
    orderBy: [{ created_at: "asc" }],
  });

  return sessions as ExistingSessionInfo[];
}

function computeSessionMetadata(
  planificables: PlanificableProduct[],
  sessions: ExistingSessionInfo[]
) {
  const flagged = new Set<string>();
  const empty = new Set<string>();
  const sessionsByProduct = new Map<string, ExistingSessionInfo[]>();

  for (const session of sessions) {
    if (isSessionEmpty(session)) {
      empty.add(session.session_id);
    }
    if (session.deal_product_id) {
      const list = sessionsByProduct.get(session.deal_product_id) ?? [];
      list.push(session);
      sessionsByProduct.set(session.deal_product_id, list);
    }
  }

  for (const product of planificables) {
    if (!product?.id) continue;
    const quantity = ensurePositiveInt(product.quantity);
    const { flaggedIds } = assessProductSessions(
      quantity,
      sessionsByProduct.get(product.id) ?? []
    );
    flaggedIds.forEach((id) => flagged.add(id));
  }

  return { flagged, empty };
}

async function syncSessionsForDeal(prisma: ReturnType<typeof getPrisma>, dealId: string) {
  const context = await loadPlanningContext(prisma, dealId);
  if (!context) {
    return errorResponse("NOT_FOUND", "Deal no encontrado", 404);
  }

  const { planificables, defaultDireccion, defaultSede } = context;
  if (!planificables.length) {
    const total = await prisma.deal_sessions.count({ where: { deal_id: dealId } });
    return successResponse({ created: 0, deleted: 0, flagged: [], total });
  }

  const existing = await fetchExistingSessions(prisma, dealId);
  const sessionsByProduct = new Map<string, ExistingSessionInfo[]>();

  for (const session of existing) {
    if (session.deal_product_id) {
      const list = sessionsByProduct.get(session.deal_product_id) ?? [];
      list.push(session);
      sessionsByProduct.set(session.deal_product_id, list);
    }
  }

  const deletable = new Set<string>();
  const flagged = new Set<string>();
  const creations: Array<Record<string, any>> = [];

  for (const product of planificables) {
    if (!product?.id) continue;
    const quantity = ensurePositiveInt(product.quantity);
    const sessionsForProduct = sessionsByProduct.get(product.id) ?? [];

    const { deletableIds, flaggedIds, missingCount } = assessProductSessions(
      quantity,
      sessionsForProduct
    );

    deletableIds.forEach((id) => deletable.add(id));
    flaggedIds.forEach((id) => flagged.add(id));

    for (let index = 0; index < missingCount; index += 1) {
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

  if (deletable.size) {
    await prisma.deal_sessions.deleteMany({
      where: { session_id: { in: Array.from(deletable) } },
    });
  }

  if (creations.length) {
    await prisma.deal_sessions.createMany({ data: creations, skipDuplicates: true });
  }

  const total = await prisma.deal_sessions.count({ where: { deal_id: dealId } });
  return successResponse({
    created: creations.length,
    deleted: deletable.size,
    flagged: Array.from(flagged),
    total,
  });
}

async function handleCreateSession(
  prisma: ReturnType<typeof getPrisma>,
  dealId: string,
  body: any,
  expandRaw?: unknown
) {
  if (!body || typeof body !== "object") {
    return errorResponse("VALIDATION_ERROR", "Body inválido", 400);
  }

  const context = await loadPlanningContext(prisma, dealId);
  if (!context) {
    return errorResponse("NOT_FOUND", "Deal no encontrado", 404);
  }

  const expand = parseExpand(expandRaw);

  let dealProductId = toNullableString(body.deal_product_id ?? body.dealProductId);
  let productForSession: PlanificableProduct | null = null;

  if (dealProductId) {
    productForSession =
      context.planificables.find((product) => product.id === dealProductId) ?? null;

    if (!productForSession) {
      const product = await prisma.deal_products.findUnique({
        where: { id: dealProductId },
        select: { id: true, deal_id: true, code: true, hours: true },
      });
      if (!product || product.deal_id !== dealId) {
        return errorResponse(
          "VALIDATION_ERROR",
          "El producto asociado a la sesión no es válido para este presupuesto",
          400
        );
      }
      productForSession = {
        id: product.id,
        code: product.code,
        quantity: null,
        hours: product.hours,
      };
    }
  } else if (context.planificables.length === 1) {
    productForSession = context.planificables[0] ?? null;
    dealProductId = productForSession?.id ?? null;
  }

  if (!dealProductId) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Es necesario indicar el producto asociado a la sesión",
      400
    );
  }

  const sessionId = randomUUID();

  let startAt: Date | null = null;
  if (Object.prototype.hasOwnProperty.call(body, "inicio")) {
    const result = parseDateInput(body.inicio, "inicio");
    if ("error" in result) return result.error;
    startAt = result.value ?? null;
  }

  let endAt: Date | null = null;
  let explicitFin = false;
  if (Object.prototype.hasOwnProperty.call(body, "fin")) {
    explicitFin = true;
    const result = parseDateInput(body.fin, "fin");
    if ("error" in result) return result.error;
    endAt = result.value ?? null;
  }

  let salaId: string | null | undefined = undefined;
  if (Object.prototype.hasOwnProperty.call(body, "sala_id")) {
    const parsed = toNullableString(body.sala_id);
    if (parsed) {
      const salaExists = await prisma.salas.findUnique({
        where: { sala_id: parsed },
        select: { sala_id: true },
      });
      if (!salaExists) {
        return errorResponse("VALIDATION_ERROR", "La sala especificada no existe", 400);
      }
      salaId = parsed;
    } else {
      salaId = null;
    }
  }

  const direccion = Object.prototype.hasOwnProperty.call(body, "direccion")
    ? toNullableString(body.direccion)
    : null;
  const sede = Object.prototype.hasOwnProperty.call(body, "sede")
    ? toNullableString(body.sede)
    : null;
  const comentarios = Object.prototype.hasOwnProperty.call(body, "comentarios")
    ? toNullableString(body.comentarios)
    : null;

  const statusExplicitlyProvided = Object.prototype.hasOwnProperty.call(body, "estado");
  let statusValue: string | null = null;
  if (statusExplicitlyProvided) {
    const statusResult = normalizeStatusInput(body.estado);
    if (statusResult && "error" in statusResult) {
      return statusResult.error;
    }
    if (statusResult && "value" in statusResult) {
      statusValue = statusResult.value;
    }
  }

  let trainerIds: string[] = [];
  if (Object.prototype.hasOwnProperty.call(body, "formadores")) {
    const trainersRaw = body.formadores;
    if (trainersRaw === null) {
      trainerIds = [];
    } else if (Array.isArray(trainersRaw)) {
      trainerIds = Array.from(
        new Set(
          trainersRaw
            .map((id: unknown) => toNullableString(id))
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
    } else {
      return errorResponse(
        "VALIDATION_ERROR",
        "El campo formadores debe ser una lista de identificadores",
        400
      );
    }
  }

  let mobileUnitIds: string[] = [];
  if (Object.prototype.hasOwnProperty.call(body, "unidades_moviles")) {
    const unitsRaw = body.unidades_moviles;
    if (unitsRaw === null) {
      mobileUnitIds = [];
    } else if (Array.isArray(unitsRaw)) {
      mobileUnitIds = Array.from(
        new Set(
          unitsRaw
            .map((id: unknown) => toNullableString(id))
            .filter((id): id is string => Boolean(id))
        )
      );

      if (mobileUnitIds.length) {
        const units = await prisma.unidades_moviles.findMany({
          where: { unidad_id: { in: mobileUnitIds } },
          select: { unidad_id: true },
        });
        if (units.length !== mobileUnitIds.length) {
          return errorResponse(
            "VALIDATION_ERROR",
            "Alguna de las unidades móviles especificadas no existe",
            400
          );
        }
      }
    } else {
      return errorResponse(
        "VALIDATION_ERROR",
        "El campo unidades_moviles debe ser una lista de identificadores",
        400
      );
    }
  }

  if (
    startAt &&
    !explicitFin &&
    productForSession &&
    ensurePositiveInt(productForSession.hours) > 0
  ) {
    const hours = ensurePositiveInt(productForSession.hours);
    const startDate = startAt instanceof Date ? startAt : new Date(startAt);
    endAt = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
  }

  const nextSala = salaId === undefined ? null : salaId;
  const requiredComplete = Boolean(
    startAt &&
    endAt &&
    nextSala &&
    trainerIds.length > 0 &&
    direccion &&
    sede
  );

  const normalizedStart =
    startAt instanceof Date ? startAt : startAt ? new Date(startAt) : null;
  const normalizedEnd = endAt instanceof Date ? endAt : endAt ? new Date(endAt) : null;

  const hasValidRange =
    normalizedStart instanceof Date &&
    normalizedEnd instanceof Date &&
    !Number.isNaN(normalizedStart.getTime()) &&
    !Number.isNaN(normalizedEnd.getTime()) &&
    normalizedEnd.getTime() > normalizedStart.getTime();

  if (hasValidRange) {
    const range = { start: normalizedStart as Date, end: normalizedEnd as Date };
    const conflicts: ResourceConflictSummary[] = [];

    const nextSalaId = typeof nextSala === "string" && nextSala.trim().length ? nextSala : null;
    if (nextSalaId) {
      const roomConflictsMap = await findRoomsConflicts(prisma, [nextSalaId], range);
      const roomConflicts = roomConflictsMap.get(nextSalaId) ?? [];
      if (roomConflicts.length) {
        const salaRecord = await prisma.salas.findUnique({
          where: { sala_id: nextSalaId },
          select: { name: true },
        });
        conflicts.push({
          resource_type: "sala",
          resource_id: nextSalaId,
          resource_label: salaRecord?.name ?? null,
          conflicts: roomConflicts,
        });
      }
    }

    if (trainerIds.length) {
      const trainerConflictsMap = await findTrainersConflicts(prisma, trainerIds, range);
      const conflictingTrainerIds = Array.from(trainerConflictsMap.keys());
      if (conflictingTrainerIds.length) {
        const trainers = await prisma.trainers.findMany({
          where: { trainer_id: { in: conflictingTrainerIds } },
          select: { trainer_id: true, name: true },
        });
        const trainerLabels = new Map<string, string | null>();
        for (const trainer of trainers) {
          trainerLabels.set(trainer.trainer_id, trainer.name ?? null);
        }
        for (const trainerId of conflictingTrainerIds) {
          conflicts.push({
            resource_type: "formador",
            resource_id: trainerId,
            resource_label: trainerLabels.get(trainerId) ?? null,
            conflicts: trainerConflictsMap.get(trainerId) ?? [],
          });
        }
      }
    }

    if (mobileUnitIds.length) {
      const mobileConflictsMap = await findMobileUnitsConflicts(
        prisma,
        mobileUnitIds,
        range
      );
      const conflictingUnitIds = Array.from(mobileConflictsMap.keys());
      if (conflictingUnitIds.length) {
        const units = await prisma.unidades_moviles.findMany({
          where: { unidad_id: { in: conflictingUnitIds } },
          select: { unidad_id: true, name: true, matricula: true },
        });
        const unitLabels = new Map<string, string | null>();
        for (const unit of units) {
          const parts = [unit.name, unit.matricula]
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0);
          unitLabels.set(unit.unidad_id, parts.length ? parts.join(" - ") : null);
        }
        for (const unidadId of conflictingUnitIds) {
          conflicts.push({
            resource_type: "unidad_movil",
            resource_id: unidadId,
            resource_label: unitLabels.get(unidadId) ?? null,
            conflicts: mobileConflictsMap.get(unidadId) ?? [],
          });
        }
      }
    }

    if (conflicts.length) {
      const firstConflict = conflicts[0];
      const firstDetail = firstConflict.conflicts[0];
      const resourceTypeLabel =
        firstConflict.resource_type === "sala"
          ? "La sala seleccionada"
          : firstConflict.resource_type === "formador"
          ? "El formador seleccionado"
          : "La unidad móvil seleccionada";
      const resourceLabel = firstConflict.resource_label ?? firstConflict.resource_id;
      const dealLabel =
        firstDetail?.deal_title ?? firstDetail?.organization_name ?? firstDetail?.deal_id;
      const rangeLabel = formatRangeForMessage(
        firstDetail?.inicio ?? null,
        firstDetail?.fin ?? null
      );

      const messageParts = [
        `${resourceTypeLabel}${resourceLabel ? ` (${resourceLabel})` : ""}`,
      ];
      if (dealLabel) {
        messageParts.push(`ya está asignado a ${dealLabel}`);
      }
      if (rangeLabel) {
        messageParts.push(`en el horario ${rangeLabel}`);
      }

      return errorResponse("RESOURCE_CONFLICT", `${messageParts.join(" ")}.`, 409, {
        conflicts,
      });
    }
  }

  if (statusExplicitlyProvided && statusValue === "Planificada" && !requiredComplete) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Para marcar la sesión como Planificada deben completarse inicio, fin, sala, al menos un formador, dirección y sede",
      400
    );
  }

  const finalStatus = statusValue
    ? statusValue
    : requiredComplete
    ? "Planificada"
    : "Borrador";

  const createData: Record<string, any> = {
    session_id: sessionId,
    deal_id: dealId,
    deal_product_id: dealProductId,
    status: finalStatus,
    start_at: startAt ?? null,
    end_at: endAt ?? null,
    direccion,
    sede,
    comentarios,
    origen: productForSession?.code ?? null,
  };

  if (salaId !== undefined) {
    createData.sala_id = salaId;
  }

  const operations: any[] = [prisma.deal_sessions.create({ data: createData })];

  if (trainerIds.length) {
    operations.push(
      prisma.deal_session_trainers.createMany({
        data: trainerIds.map((trainerId) => ({
          session_id: sessionId,
          trainer_id: trainerId,
        })),
      })
    );
  }

  if (mobileUnitIds.length) {
    operations.push(
      prisma.deal_session_mobile_units.createMany({
        data: mobileUnitIds.map((unidadId) => ({
          session_id: sessionId,
          unidad_id: unidadId,
        })),
      })
    );
  }

  await prisma.$transaction(operations);

  const include = buildInclude(expand);
  const created = await prisma.deal_sessions.findUnique({
    where: { session_id: sessionId },
    include: Object.keys(include).length ? include : undefined,
  });

  if (!created) {
    return errorResponse("NOT_FOUND", "Sesión no encontrada", 404);
  }

  const metadata = computeSessionMetadata(
    context.planificables,
    await fetchExistingSessions(prisma, dealId)
  );

  return successResponse({
    session: mapSession(created as any, expand, metadata),
  });
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
      mobile_units: { select: { unidad_id: true } },
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
  let mobileUnitIdsForUpdate: string[] | null = null;

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
      mobileUnitIdsForUpdate = [];
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
        mobileUnitIdsForUpdate = unitIds;
        operations.push(
          prisma.deal_session_mobile_units.createMany({
            data: unitIds.map((unidadId) => ({
              session_id: sessionId,
              unidad_id: unidadId,
            })),
          })
        );
      } else {
        mobileUnitIdsForUpdate = [];
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

  const normalizedStart =
    nextStart instanceof Date
      ? nextStart
      : nextStart
      ? new Date(nextStart)
      : null;
  const normalizedEnd =
    nextEnd instanceof Date ? nextEnd : nextEnd ? new Date(nextEnd) : null;

  const hasValidRange =
    normalizedStart instanceof Date &&
    normalizedEnd instanceof Date &&
    !Number.isNaN(normalizedStart.getTime()) &&
    !Number.isNaN(normalizedEnd.getTime()) &&
    normalizedEnd.getTime() > normalizedStart.getTime();

  if (hasValidRange) {
    const range = {
      start: normalizedStart as Date,
      end: normalizedEnd as Date,
      excludeSessionId: sessionId,
    };

    const conflicts: ResourceConflictSummary[] = [];

    const nextSalaId =
      typeof nextSala === "string" && nextSala.trim().length ? nextSala : null;
    if (nextSalaId) {
      const roomConflictsMap = await findRoomsConflicts(prisma, [nextSalaId], range);
      const roomConflicts = roomConflictsMap.get(nextSalaId) ?? [];
      if (roomConflicts.length) {
        const salaRecord = await prisma.salas.findUnique({
          where: { sala_id: nextSalaId },
          select: { name: true },
        });
        conflicts.push({
          resource_type: "sala",
          resource_id: nextSalaId,
          resource_label: salaRecord?.name ?? null,
          conflicts: roomConflicts,
        });
      }
    }

    const existingTrainerIds = Array.isArray(session.trainers)
      ? session.trainers
          .map((entry) => entry.trainer_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const trainerIdsToCheck =
      trainerIdsForUpdate !== null ? trainerIdsForUpdate : existingTrainerIds;
    const uniqueTrainerIds = Array.from(new Set(trainerIdsToCheck));
    if (uniqueTrainerIds.length) {
      const trainerConflictsMap = await findTrainersConflicts(
        prisma,
        uniqueTrainerIds,
        range
      );
      const conflictingTrainerIds = Array.from(trainerConflictsMap.keys());
      if (conflictingTrainerIds.length) {
        const trainerLabels = new Map<string, string | null>();
        const trainers = await prisma.trainers.findMany({
          where: { trainer_id: { in: conflictingTrainerIds } },
          select: { trainer_id: true, name: true },
        });
        for (const trainer of trainers) {
          trainerLabels.set(trainer.trainer_id, trainer.name ?? null);
        }
        for (const trainerId of conflictingTrainerIds) {
          conflicts.push({
            resource_type: "formador",
            resource_id: trainerId,
            resource_label: trainerLabels.get(trainerId) ?? null,
            conflicts: trainerConflictsMap.get(trainerId) ?? [],
          });
        }
      }
    }

    const existingMobileUnits = Array.isArray(session.mobile_units)
      ? session.mobile_units
          .map((entry) => entry.unidad_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const mobileUnitIdsToCheck =
      mobileUnitIdsForUpdate !== null
        ? mobileUnitIdsForUpdate
        : existingMobileUnits;
    const uniqueMobileUnitIds = Array.from(new Set(mobileUnitIdsToCheck));
    if (uniqueMobileUnitIds.length) {
      const mobileUnitConflictsMap = await findMobileUnitsConflicts(
        prisma,
        uniqueMobileUnitIds,
        range
      );
      const conflictingUnitIds = Array.from(mobileUnitConflictsMap.keys());
      if (conflictingUnitIds.length) {
        const unitLabels = new Map<string, string | null>();
        const units = await prisma.unidades_moviles.findMany({
          where: { unidad_id: { in: conflictingUnitIds } },
          select: { unidad_id: true, name: true, matricula: true },
        });
        for (const unit of units) {
          const parts = [unit.name, unit.matricula]
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0);
          unitLabels.set(unit.unidad_id, parts.length ? parts.join(" - ") : null);
        }
        for (const unidadId of conflictingUnitIds) {
          conflicts.push({
            resource_type: "unidad_movil",
            resource_id: unidadId,
            resource_label: unitLabels.get(unidadId) ?? null,
            conflicts: mobileUnitConflictsMap.get(unidadId) ?? [],
          });
        }
      }
    }

    if (conflicts.length) {
      const firstConflict = conflicts[0];
      const firstDetail = firstConflict.conflicts[0];
      const resourceTypeLabel =
        firstConflict.resource_type === "sala"
          ? "La sala seleccionada"
          : firstConflict.resource_type === "formador"
          ? "El formador seleccionado"
          : "La unidad móvil seleccionada";
      const resourceLabel = firstConflict.resource_label ?? firstConflict.resource_id;
      const dealLabel =
        firstDetail.deal_title ??
        firstDetail.organization_name ??
        firstDetail.deal_id;
      const rangeLabel = formatRangeForMessage(firstDetail.inicio, firstDetail.fin);

      const messageParts = [
        `${resourceTypeLabel}${resourceLabel ? ` (${resourceLabel})` : ""}`,
      ];
      if (dealLabel) {
        messageParts.push(`ya está asignado a ${dealLabel}`);
      }
      if (rangeLabel) {
        messageParts.push(`en el horario ${rangeLabel}`);
      }

      return errorResponse("RESOURCE_CONFLICT", `${messageParts.join(" ")}.`, 409, {
        conflicts,
      });
    }
  }

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
    await ensureDealSessionsSchema(prisma);
    const method = event.httpMethod;
    const path = event.path || "";
    const normalizedPath = path.replace(/\/$/, "");
    const rawSessionId = parseSessionIdFromPath(path);
    const isSyncRoute = /\/deal-sessions\/sync$/i.test(normalizedPath);
    const sessionIdFromPath = isSyncRoute ? null : rawSessionId;

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

      const context = await loadPlanningContext(prisma, dealId);
      const planificables = context?.planificables ?? [];
      const assessmentInput: ExistingSessionInfo[] = sessions.map((session: any) => ({
        session_id: session.session_id,
        deal_id: session.deal_id,
        deal_product_id: session.deal_product_id,
        status: session.status,
        start_at: session.start_at,
        end_at: session.end_at,
        sala_id: session.sala_id,
        direccion: session.direccion,
        sede: session.sede,
        comentarios: session.comentarios,
        created_at: session.created_at,
        trainers: Array.isArray(session.trainers)
          ? session.trainers.map((entry: any) => ({ trainer_id: entry.trainer_id }))
          : undefined,
        mobile_units: Array.isArray(session.mobile_units)
          ? session.mobile_units.map((entry: any) => ({ unidad_id: entry.unidad_id }))
          : undefined,
      }));

      const metadata = computeSessionMetadata(planificables, assessmentInput);

      return successResponse({
        sessions: sessions.map((session: any) =>
          mapSession(session, expand, {
            exceeding: metadata.flagged,
            empty: metadata.empty,
          })
        ),
      });
    }

    if (method === "POST" && isSyncRoute) {
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

    if (method === "POST" && !sessionIdFromPath) {
      if (!event.body) {
        return errorResponse("VALIDATION_ERROR", "Body requerido", 400);
      }
      const body = JSON.parse(event.body || "{}");
      const dealId = toNullableString(body?.dealId ?? body?.deal_id);
      if (!dealId) {
        return errorResponse("VALIDATION_ERROR", "Falta dealId", 400);
      }

      const expandRaw = body.expand ?? event.queryStringParameters?.expand;
      const sessionFieldKeys = [
        "inicio",
        "fin",
        "sala_id",
        "formadores",
        "unidades_moviles",
        "direccion",
        "sede",
        "comentarios",
        "estado",
        "deal_product_id",
        "dealProductId",
      ];

      const hasSessionFields = sessionFieldKeys.some((key) =>
        Object.prototype.hasOwnProperty.call(body, key)
      );

      if (hasSessionFields) {
        return await handleCreateSession(prisma, dealId, body, expandRaw);
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
