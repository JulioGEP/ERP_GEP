// backend/functions/trainer-sessions.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';

type SessionRecord = {
  id: string;
  deal_id: string;
  nombre_cache: string | null;
  direccion: string | null;
  fecha_inicio_utc: Date | string | null;
  fecha_fin_utc: Date | string | null;
  deal_products: { name: string | null; code: string | null } | null;
  deals: {
    deal_id: string | null;
    pipeline_id: string | null;
    training_address: string | null;
    caes_val: boolean | null;
    caes_label: string | null;
    fundae_val: boolean | null;
    fundae_label: string | null;
    comercial: string | null;
    organizations: { name: string | null } | null;
    persons: {
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  } | null;
  sesion_trainers: Array<{
    trainer_id: string | null;
    trainers: {
      trainer_id: string | null;
      name: string | null;
      apellido: string | null;
    } | null;
  }> | null;
  sesion_unidades: Array<{
    unidad_movil_id: string | null;
    unidades_moviles: {
      unidad_id: string | null;
      name: string | null;
      matricula: string | null;
    } | null;
  }> | null;
  trainer_session_invites: Array<{
    trainer_id: string | null;
    status: string | null;
    token: string | null;
  }> | null;
};

type VariantRecord = {
  id: string;
  id_woo: bigint | number | string | null;
  date: Date | string | null;
  sede: string | null;
  products: { name: string | null } | null;
};

type VariantDealRecord = {
  deal_id: string | null;
  w_id_variation: string | null;
  fundae_label: string | null;
  organizations: { name: string | null } | null;
  _count: { alumnos: number } | null;
  alumnos: Array<{
    id: string | null;
    nombre: string | null;
    apellido: string | null;
    dni: string | null;
    apto: boolean | null;
    deal_id: string | null;
  }> | null;
};

type VariantDealPayload = {
  dealId: string;
  organizationName: string | null;
  fundaeLabel: string | null;
  studentCount: number;
  students: Array<{
    id: string;
    dealId: string;
    nombre: string | null;
    apellido: string | null;
    dni: string | null;
    apto: boolean;
    organizationName: string | null;
    fundaeLabel: string | null;
  }>;
};

type VariantPayload = {
  variantId: string;
  productName: string | null;
  site: string | null;
  date: string | null;
  wooId: string | null;
  studentCount: number;
  organizationNames: string[];
  deals: Array<{
    dealId: string;
    organizationName: string | null;
    fundaeLabel: string | null;
    studentCount: number;
  }>;
  students: Array<{
    id: string;
    dealId: string;
    nombre: string | null;
    apellido: string | null;
    dni: string | null;
    apto: boolean;
    organizationName: string | null;
    fundaeLabel: string | null;
  }>;
};

type SessionPayload = {
  sessionId: string;
  dealId: string;
  budgetNumber: string | null;
  organizationName: string | null;
  commercialName: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  sessionTitle: string | null;
  formationName: string | null;
  formationTemplate: string | null;
  formationUrl: string | null;
  address: string | null;
  caes: { value: boolean | null; label: string | null };
  fundae: { value: boolean | null; label: string | null };
  startDate: string | null;
  endDate: string | null;
  mobileUnits: Array<{ id: string; name: string | null; plate: string | null }>;
  isCompanyTraining: boolean;
  isGepServices: boolean;
  companionTrainers: Array<{ trainerId: string; name: string | null; lastName: string | null }>;
  trainerInviteStatus: TrainerInviteStatus | null;
  trainerInviteToken: string | null;
  trainerInviteType: 'SESSION' | 'VARIANT' | null;
};

type VariantInviteRecord = {
  variant_id: string | null;
  token: string | null;
  variant: {
    id: string | null;
    name: string | null;
    date: Date | string | null;
    sede: string | null;
    products: {
      name: string | null;
      code: string | null;
      hora_inicio: Date | string | null;
      hora_fin: Date | string | null;
    } | null;
  } | null;
};

type TrainerInviteStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

const PIPELINE_LABELS_COMPANY = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
];

const PIPELINE_LABELS_GEP_SERVICES = ['gep services'];

function normalizePipeline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isCompanyPipeline(value: unknown): boolean {
  const normalized = normalizePipeline(value);
  if (!normalized) return false;
  return PIPELINE_LABELS_COMPANY.includes(normalized);
}

function isGepServicesPipeline(value: unknown): boolean {
  const normalized = normalizePipeline(value);
  if (!normalized) return false;
  return PIPELINE_LABELS_GEP_SERVICES.includes(normalized);
}

function toDateKey(value: Date | string | null | undefined): string | null {
  const iso = toMadridISOString(value ?? null);
  if (!iso) return null;
  return iso.slice(0, 10);
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return null;
    if (['true', '1', 'si', 'sí', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
}

function normalizeTrainerInviteStatus(value: unknown): TrainerInviteStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized;
  }
  return null;
}

type TimeParts = { hour: number; minute: number };

function parseInviteTimeParts(value: Date | string | null | undefined): TimeParts | null {
  const formatted = formatTimeFromDb(value ?? null);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildInviteDate(base: Date, time: TimeParts): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: time.hour, minute: time.minute });
}

function computeVariantInviteRange(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): { start: Date; end: Date } | null {
  if (!variantDate) return null;
  const parsed = new Date(variantDate as any);
  if (!Number.isFinite(parsed.getTime())) return null;
  const startTime = parseInviteTimeParts(productTimes.hora_inicio);
  const endTime = parseInviteTimeParts(productTimes.hora_fin);
  const startParts = startTime ?? { hour: 9, minute: 0 };
  const endParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });
  const start = buildInviteDate(parsed, startParts);
  let end = buildInviteDate(parsed, endParts);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  return { start, end };
}

function sanitizeBigInt(value: unknown): string | null {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const pattern = new RegExp(`\\b${relation}\\b`, 'i');
  return pattern.test(message);
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Formador'] });

  if ('error' in auth) {
    return auth.error;
  }

  const trainer = await prisma.trainers.findUnique({
    where: { user_id: auth.user.id },
    select: { trainer_id: true },
  });

  if (!trainer) {
    return successResponse({ dates: [] });
  }

  const trainerId = sanitizeString(trainer.trainer_id) ?? trainer.trainer_id;

  const sessions = (await prisma.sesiones.findMany({
    where: {
      sesion_trainers: { some: { trainer_id: trainer.trainer_id } },
    },
    select: {
      id: true,
      deal_id: true,
      nombre_cache: true,
      direccion: true,
      fecha_inicio_utc: true,
      fecha_fin_utc: true,
      deal_products: { select: { name: true, code: true } },
      deals: {
        select: {
          deal_id: true,
          pipeline_id: true,
          training_address: true,
          caes_val: true,
          caes_label: true,
          fundae_val: true,
          fundae_label: true,
          comercial: true,
          organizations: { select: { name: true } },
          persons: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
        },
      },
      sesion_trainers: {
        select: {
          trainer_id: true,
          trainers: { select: { trainer_id: true, name: true, apellido: true } },
        },
      },
      sesion_unidades: {
        select: {
          unidad_movil_id: true,
          unidades_moviles: {
            select: {
              unidad_id: true,
              name: true,
              matricula: true,
            },
          },
        },
      },
      trainer_session_invites: {
        select: {
          trainer_id: true,
          status: true,
          token: true,
        },
      },
    },
    orderBy: [{ fecha_inicio_utc: 'asc' }],
  })) as SessionRecord[];

  const productCodeMap = new Map<string, string | null>();
  const productNameMap = new Map<string, string | null>();
  const productTemplateByCode = new Map<string, string | null>();
  const productTemplateByName = new Map<string, string | null>();

  const productCodes = new Set<string>();
  const productNames = new Set<string>();
  for (const session of sessions) {
    const code = sanitizeString(session.deal_products?.code ?? null);
    if (code) {
      productCodes.add(code);
    }
    const name = sanitizeString(session.deal_products?.name ?? null);
    if (name) {
      productNames.add(name);
    }
  }

  const productFilters: Array<{ id_pipe?: { in: string[] }; name?: { in: string[] } }> = [];
  if (productCodes.size) {
    productFilters.push({ id_pipe: { in: Array.from(productCodes) } });
  }
  if (productNames.size) {
    productFilters.push({ name: { in: Array.from(productNames) } });
  }

  if (productFilters.length) {
    const products = await prisma.products.findMany({
      where: { OR: productFilters },
      select: { id_pipe: true, name: true, url_formacion: true, template: true },
    });

    for (const product of products) {
      const url = sanitizeString(product.url_formacion ?? null);
      const code = sanitizeString(product.id_pipe);
      const template = sanitizeString(product.template ?? null);
      if (code) {
        productCodeMap.set(code, url);
        productTemplateByCode.set(code, template);
      }
      const name = sanitizeString(product.name ?? null);
      if (name) {
        productNameMap.set(name, url);
        productTemplateByName.set(name, template);
      }
    }
  }

  const sessionEntries = sessions
    .map((session) => {
      const startDate = toMadridISOString(session.fecha_inicio_utc);
      const endDate = toMadridISOString(session.fecha_fin_utc);
      const dateKey = startDate?.slice(0, 10) ?? endDate?.slice(0, 10) ?? null;
      if (!dateKey) return null;

      const deal = session.deals ?? null;
      const organizationName = sanitizeString(deal?.organizations?.name ?? null);
      const budgetNumber = sanitizeString(deal?.deal_id ?? null);
      const formationName = sanitizeString(session.deal_products?.name ?? null);
      const formationCode = sanitizeString(session.deal_products?.code ?? null);
      const formationUrl =
        (formationCode ? productCodeMap.get(formationCode) ?? null : null) ??
        (formationName ? productNameMap.get(formationName) ?? null : null);
      const formationTemplate =
        (formationCode ? productTemplateByCode.get(formationCode) ?? null : null) ??
        (formationName ? productTemplateByName.get(formationName) ?? null : null);
      const sessionTitle = sanitizeString(session.nombre_cache);
      const address = sanitizeString(session.direccion ?? deal?.training_address ?? null);
      const caesValue = sanitizeBoolean(deal?.caes_val);
      const caesLabel = sanitizeString(deal?.caes_label ?? null);
      const fundaeValue = sanitizeBoolean(deal?.fundae_val);
      const fundaeLabel = sanitizeString(deal?.fundae_label ?? null);
      const commercialName = sanitizeString(deal?.comercial ?? null);

      const companionTrainers = Array.isArray(session.sesion_trainers)
        ? session.sesion_trainers
            .map((link) => {
              const trainerIdRaw =
                sanitizeString(link?.trainer_id ?? null) ??
                sanitizeString(link?.trainers?.trainer_id ?? null);
              if (!trainerIdRaw || trainerIdRaw === trainerId) {
                return null;
              }
              const name = sanitizeString(link?.trainers?.name ?? null);
              const lastName = sanitizeString(link?.trainers?.apellido ?? null);
              return {
                trainerId: trainerIdRaw,
                name,
                lastName,
              };
            })
            .filter((value): value is { trainerId: string; name: string | null; lastName: string | null } => value !== null)
        : [];

      const inviteRecords = Array.isArray(session.trainer_session_invites)
        ? session.trainer_session_invites
        : [];
      const inviteForTrainer = inviteRecords.find((invite) => {
        const inviteTrainerId = sanitizeString(invite?.trainer_id ?? null);
        return inviteTrainerId === trainerId;
      });
      const trainerInviteStatus = inviteForTrainer ? normalizeTrainerInviteStatus(inviteForTrainer.status) : null;
      const trainerInviteToken = inviteForTrainer ? sanitizeString(inviteForTrainer.token ?? null) : null;
      const trainerInviteType = trainerInviteToken ? 'SESSION' : null;

      const contactFirstName = sanitizeString(deal?.persons?.first_name ?? null);
      const contactLastName = sanitizeString(deal?.persons?.last_name ?? null);
      const clientName = sanitizeString(
        [contactFirstName, contactLastName].filter(Boolean).join(' '),
      );
      const clientPhone = sanitizeString(deal?.persons?.phone ?? null);
      const clientEmail = sanitizeString(deal?.persons?.email ?? null);

      const mobileUnits = Array.isArray(session.sesion_unidades)
        ? session.sesion_unidades
            .map((link) => {
              const unit = link?.unidades_moviles ?? null;
              const id = sanitizeString(unit?.unidad_id ?? link?.unidad_movil_id);
              if (!id) return null;
              return {
                id,
                name: sanitizeString(unit?.name ?? null),
                plate: sanitizeString(unit?.matricula ?? null),
              };
            })
            .filter((unit): unit is { id: string; name: string | null; plate: string | null } => unit !== null)
        : [];

      const pipeline = deal?.pipeline_id ?? null;
      const isCompanyTraining = isCompanyPipeline(pipeline);
      const isGepServices = isGepServicesPipeline(pipeline);

      return {
        dateKey,
        session: {
          sessionId: session.id,
          dealId: session.deal_id,
          budgetNumber,
          organizationName,
          commercialName,
          clientName,
          clientPhone,
          clientEmail,
          sessionTitle,
          formationName,
          formationTemplate,
          formationUrl,
          address,
          caes: { value: caesValue, label: caesLabel },
          fundae: { value: fundaeValue, label: fundaeLabel },
          startDate,
          endDate,
          mobileUnits,
          isCompanyTraining,
          isGepServices,
          companionTrainers,
          trainerInviteStatus,
          trainerInviteToken,
          trainerInviteType,
        },
      };
    })
    .filter((entry): entry is { dateKey: string; session: any } => entry !== null);

  const variantInviteRecords = (await prisma.variant_trainer_invites.findMany({
    where: { trainer_id: trainer.trainer_id, status: 'PENDING' },
    select: {
      variant_id: true,
      token: true,
      variant: {
        select: {
          id: true,
          name: true,
          date: true,
          sede: true,
          products: { select: { name: true, code: true, hora_inicio: true, hora_fin: true } },
        },
      },
    },
  })) as VariantInviteRecord[];

  for (const invite of variantInviteRecords) {
    const variant = invite.variant ?? null;
    const variantId = sanitizeString(variant?.id ?? invite.variant_id ?? null);
    const token = sanitizeString(invite.token ?? null);
    if (!variantId || !token) continue;

    const range = computeVariantInviteRange(variant?.date ?? null, {
      hora_inicio: variant?.products?.hora_inicio ?? null,
      hora_fin: variant?.products?.hora_fin ?? null,
    });

    const startDateIso = range?.start
      ? toMadridISOString(range.start)
      : toMadridISOString(variant?.date ?? null);
    const endDateIso = range?.end ? toMadridISOString(range.end) : startDateIso;
    const dateKey =
      startDateIso?.slice(0, 10) ?? endDateIso?.slice(0, 10) ?? `variant:${variantId}`;

    const sessionTitle =
      sanitizeString(variant?.name ?? null) ??
      sanitizeString(variant?.products?.name ?? null) ??
      'Formación abierta';

    sessionEntries.push({
      dateKey,
      session: {
        sessionId: `variant:${variantId}`,
        dealId: `variant:${variantId}`,
        budgetNumber: null,
        organizationName: null,
        commercialName: null,
        clientName: null,
        clientPhone: null,
        clientEmail: null,
        sessionTitle,
        formationName: sanitizeString(variant?.products?.name ?? null),
        formationTemplate: null,
        formationUrl: null,
        address: sanitizeString(variant?.sede ?? null),
        caes: { value: null, label: null },
        fundae: { value: null, label: null },
        startDate: startDateIso,
        endDate: endDateIso,
        mobileUnits: [],
        isCompanyTraining: false,
        isGepServices: false,
        companionTrainers: [],
        trainerInviteStatus: 'PENDING',
        trainerInviteToken: token,
        trainerInviteType: 'VARIANT',
      },
    });
  }

  const variantIds = new Set<string>();

  const primaryVariants = (await prisma.variants.findMany({
    where: { trainer_id: trainer.trainer_id },
    select: { id: true },
  })) as Array<{ id: unknown }>;

  primaryVariants.forEach((variant) => {
    if (variant.id) {
      variantIds.add(String(variant.id));
    }
  });

  try {
    const rows = (await prisma.$queryRaw<{ variant_id: string }[]>`
      SELECT variant_id::text AS variant_id
      FROM variant_trainer_links
      WHERE trainer_id = ${trainer.trainer_id}
    `) as Array<{ variant_id: string }>;

    for (const row of rows) {
      if (row.variant_id) {
        variantIds.add(String(row.variant_id));
      }
    }
  } catch (error) {
    if (!isMissingRelationError(error, 'variant_trainer_links')) {
      throw error;
    }
  }

  let variantEntries: Array<{ dateKey: string; variant: VariantPayload }> = [];

  if (variantIds.size) {
    const variants = (await prisma.variants.findMany({
      where: { id: { in: Array.from(variantIds) } },
      select: {
        id: true,
        id_woo: true,
        date: true,
        sede: true,
        products: { select: { name: true } },
      },
    })) as VariantRecord[];

    const variantWooIds = Array.from(
      new Set(
        variants
          .map((variant) => sanitizeBigInt(variant.id_woo))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const dealsByWooId = new Map<string, VariantDealPayload[]>();

    if (variantWooIds.length) {
      const variantDeals = (await prisma.deals.findMany({
        where: { w_id_variation: { in: variantWooIds } },
        select: {
          deal_id: true,
          w_id_variation: true,
          fundae_label: true,
          organizations: { select: { name: true } },
          _count: { select: { alumnos: true } },
          alumnos: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              dni: true,
              apto: true,
              deal_id: true,
            },
          },
        },
      })) as VariantDealRecord[];

      for (const deal of variantDeals) {
        const wooId = sanitizeString(deal.w_id_variation);
        if (!wooId) continue;
        const dealId = sanitizeString(deal.deal_id);
        if (!dealId) continue;
        const organizationName = sanitizeString(deal.organizations?.name ?? null);
        const fundaeLabel = sanitizeString(deal.fundae_label ?? null);

        const studentRecords = Array.isArray(deal.alumnos) ? deal.alumnos : [];
        const students = studentRecords
          .map((record) => {
            const studentId = sanitizeString(record.id);
            if (!studentId) return null;
            const studentDealId = sanitizeString(record.deal_id) ?? dealId;
            return {
              id: studentId,
              dealId: studentDealId,
              nombre: sanitizeString(record.nombre),
              apellido: sanitizeString(record.apellido),
              dni: sanitizeString(record.dni),
              apto: Boolean(record.apto),
              organizationName,
              fundaeLabel,
            } satisfies VariantDealPayload['students'][number];
          })
          .filter((student): student is VariantDealPayload['students'][number] => student !== null);

        const studentCountRaw = deal._count?.alumnos;
        const studentCount =
          typeof studentCountRaw === 'number' && Number.isFinite(studentCountRaw)
            ? Math.max(0, Math.trunc(studentCountRaw))
            : students.length;

        const payload: VariantDealPayload = {
          dealId,
          organizationName,
          fundaeLabel,
          studentCount,
          students,
        };

        const existing = dealsByWooId.get(wooId);
        if (existing) {
          existing.push(payload);
        } else {
          dealsByWooId.set(wooId, [payload]);
        }
      }
    }

    variantEntries = variants
      .map((variant) => {
        const variantId = sanitizeString(variant.id);
        if (!variantId) return null;
        const dateKey = toDateKey(variant.date);
        if (!dateKey) return null;
        const wooId = sanitizeBigInt(variant.id_woo);
        const deals = wooId ? dealsByWooId.get(wooId) ?? [] : [];
        const students = deals.flatMap((deal) => deal.students);
        const studentCount = deals.reduce((total, deal) => total + deal.studentCount, 0);
        const organizationNames = Array.from(
          new Set(
            deals
              .map((deal) => deal.organizationName)
              .filter((name): name is string => Boolean(name)),
          ),
        );
        const sanitizedDeals = deals.map((deal) => ({
          dealId: deal.dealId,
          organizationName: deal.organizationName,
          fundaeLabel: deal.fundaeLabel,
          studentCount: deal.studentCount,
        }));
        return {
          dateKey,
          variant: {
            variantId,
            productName: sanitizeString(variant.products?.name ?? null),
            site: sanitizeString(variant.sede ?? null),
            date: toMadridISOString(variant.date),
            wooId,
            studentCount,
            organizationNames,
            deals: sanitizedDeals,
            students,
          },
        };
      })
      .filter((entry): entry is { dateKey: string; variant: VariantPayload } => entry !== null);
  }

  const map = new Map<string, { sessions: SessionPayload[]; variants: VariantPayload[] }>();

  for (const entry of sessionEntries) {
    const bucket = map.get(entry.dateKey);
    if (bucket) {
      bucket.sessions.push(entry.session);
    } else {
      map.set(entry.dateKey, { sessions: [entry.session], variants: [] });
    }
  }

  for (const entry of variantEntries) {
    const bucket = map.get(entry.dateKey);
    if (bucket) {
      bucket.variants.push(entry.variant);
    } else {
      map.set(entry.dateKey, { sessions: [], variants: [entry.variant] });
    }
  }

  const dates = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, sessions: value.sessions, variants: value.variants }));

  return successResponse({ dates });
});
