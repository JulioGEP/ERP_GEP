// backend/functions/trainer-sessions.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
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
    organizations: { name: string | null } | null;
  } | null;
  sesion_unidades: Array<{
    unidad_movil_id: string | null;
    unidades_moviles: {
      unidad_id: string | null;
      name: string | null;
      matricula: string | null;
    } | null;
  }> | null;
};

type VariantRecord = {
  id: string;
  date: Date | string | null;
  sede: string | null;
  products: { name: string | null } | null;
};

const PIPELINE_LABELS_COMPANY = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
];

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
          organizations: { select: { name: true } },
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
    },
    orderBy: [{ fecha_inicio_utc: 'asc' }],
  })) as SessionRecord[];

  const productCodeMap = new Map<string, string | null>();
  const productNameMap = new Map<string, string | null>();

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
      select: { id_pipe: true, name: true, url_formacion: true },
    });

    for (const product of products) {
      const url = sanitizeString(product.url_formacion ?? null);
      const code = sanitizeString(product.id_pipe);
      if (code) {
        productCodeMap.set(code, url);
      }
      const name = sanitizeString(product.name ?? null);
      if (name) {
        productNameMap.set(name, url);
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
      const sessionTitle = sanitizeString(session.nombre_cache);
      const address = sanitizeString(session.direccion ?? deal?.training_address ?? null);
      const caesValue = sanitizeBoolean(deal?.caes_val);
      const caesLabel = sanitizeString(deal?.caes_label ?? null);
      const fundaeValue = sanitizeBoolean(deal?.fundae_val);
      const fundaeLabel = sanitizeString(deal?.fundae_label ?? null);

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

      return {
        dateKey,
        session: {
          sessionId: session.id,
          dealId: session.deal_id,
          budgetNumber,
          organizationName,
          sessionTitle,
          formationName,
          formationUrl,
          address,
          caes: { value: caesValue, label: caesLabel },
          fundae: { value: fundaeValue, label: fundaeLabel },
          startDate,
          endDate,
          mobileUnits,
          isCompanyTraining,
        },
      };
    })
    .filter((entry): entry is { dateKey: string; session: any } => entry !== null);

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

  let variantEntries: Array<{ dateKey: string; variant: { variantId: string; productName: string | null; site: string | null; date: string | null } }> = [];

  if (variantIds.size) {
    const variants = (await prisma.variants.findMany({
      where: { id: { in: Array.from(variantIds) } },
      select: {
        id: true,
        date: true,
        sede: true,
        products: { select: { name: true } },
      },
    })) as VariantRecord[];

    variantEntries = variants
      .map((variant) => {
        const variantId = sanitizeString(variant.id);
        if (!variantId) return null;
        const dateKey = toDateKey(variant.date);
        if (!dateKey) return null;
        return {
          dateKey,
          variant: {
            variantId,
            productName: sanitizeString(variant.products?.name ?? null),
            site: sanitizeString(variant.sede ?? null),
            date: toMadridISOString(variant.date),
          },
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          dateKey: string;
          variant: { variantId: string; productName: string | null; site: string | null; date: string | null };
        } => entry !== null,
      );
  }

  const map = new Map<
    string,
    {
      sessions: Array<{
        sessionId: string;
        dealId: string;
        budgetNumber: string | null;
        organizationName: string | null;
        sessionTitle: string | null;
        formationName: string | null;
        formationUrl: string | null;
        address: string | null;
        caes: { value: boolean | null; label: string | null };
        fundae: { value: boolean | null; label: string | null };
        startDate: string | null;
        endDate: string | null;
        mobileUnits: Array<{ id: string; name: string | null; plate: string | null }>;
        isCompanyTraining: boolean;
      }>;
      variants: Array<{ variantId: string; productName: string | null; site: string | null; date: string | null }>;
    }
  >();

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
