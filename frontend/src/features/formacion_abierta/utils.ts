import type {
  DealProductInfo,
  DealTag,
  ProductDefaults,
  ProductInfo,
  TrainerInviteStatus,
  VariantInfo,
  VariantLocationGroup,
  VariantMonthGroup,
  VariantSortKey,
  VariantTrainerInvite,
} from './types';

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function toTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length ? text : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value !== undefined && value !== null && !Number.isNaN(Number(value))) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toTrainerInviteStatus(value: unknown): TrainerInviteStatus {
  if (typeof value !== 'string') {
    return 'NOT_SENT';
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized as TrainerInviteStatus;
  }
  return 'NOT_SENT';
}

function toTrainerInviteResponseStatus(value: unknown): VariantTrainerInvite['status'] | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized as VariantTrainerInvite['status'];
  }
  return null;
}

export function normalizeVariantFromResponse(input: any, fallbackId: string): VariantInfo {
  const stockValue = toNumberOrNull(input?.stock);

  const trainerIdRaw = input?.trainer_id;
  const trainerId = trainerIdRaw != null && String(trainerIdRaw).trim().length
    ? String(trainerIdRaw).trim()
    : null;
  const trainerIdsRaw: unknown[] = Array.isArray(input?.trainer_ids) ? input.trainer_ids : [];
  const trainerIdSet = new Set<string>();
  if (trainerId) {
    trainerIdSet.add(trainerId);
  }
  trainerIdsRaw.forEach((value) => {
    const normalized = toTrimmedString(value);
    if (normalized) {
      trainerIdSet.add(normalized);
    }
  });

  const trainerRecordsMap = new Map<string, { trainer_id: string; name: string | null; apellido: string | null }>();
  let fallbackTrainerRecord: { trainer_id: string; name: string | null; apellido: string | null } | null = null;

  const registerTrainerRecord = (record: {
    trainer_id: string;
    name: string | null;
    apellido: string | null;
  }) => {
    if (record.trainer_id) {
      if (!trainerRecordsMap.has(record.trainer_id)) {
        trainerRecordsMap.set(record.trainer_id, record);
      }
    } else if (!fallbackTrainerRecord) {
      fallbackTrainerRecord = record;
    }
  };

  const trainersRaw: unknown[] = Array.isArray(input?.trainers) ? input.trainers : [];
  trainersRaw.forEach((trainer) => {
    if (!trainer || typeof trainer !== 'object') {
      return;
    }
    const id = toTrimmedString((trainer as any).trainer_id ?? (trainer as any).id);
    if (id) {
      trainerIdSet.add(id);
    }
    registerTrainerRecord({
      trainer_id: id ?? '',
      name: toTrimmedString((trainer as any).name),
      apellido: toTrimmedString((trainer as any).apellido),
    });
  });

  if (input?.trainer && typeof input.trainer === 'object') {
    const id = toTrimmedString(input.trainer.trainer_id) ?? trainerId ?? null;
    if (id) {
      trainerIdSet.add(id);
    }
    registerTrainerRecord({
      trainer_id: id ?? '',
      name: toTrimmedString(input.trainer.name),
      apellido: toTrimmedString(input.trainer.apellido),
    });
  }

  const trainerIds = Array.from(trainerIdSet);
  const trainers = Array.from(trainerRecordsMap.values());
  if (!trainers.length && fallbackTrainerRecord) {
    trainers.push(fallbackTrainerRecord);
  }

  const salaIdRaw = input?.sala_id;
  const salaId = salaIdRaw != null && String(salaIdRaw).trim().length
    ? String(salaIdRaw).trim()
    : null;

  const unidadIdRaw = input?.unidad_movil_id;
  const unidadId = unidadIdRaw != null && String(unidadIdRaw).trim().length
    ? String(unidadIdRaw).trim()
    : null;
  const unidadIdsRaw: unknown[] = Array.isArray(input?.unidad_movil_ids) ? input.unidad_movil_ids : [];
  const unidadIdSet = new Set<string>();
  if (unidadId) {
    unidadIdSet.add(unidadId);
  }
  unidadIdsRaw.forEach((value) => {
    const normalized = toTrimmedString(value);
    if (normalized) {
      unidadIdSet.add(normalized);
    }
  });

  const unidadRecordsMap = new Map<string, { unidad_id: string; name: string; matricula: string | null }>();
  let fallbackUnidadRecord: { unidad_id: string; name: string; matricula: string | null } | null = null;

  const registerUnidadRecord = (record: {
    unidad_id: string;
    name: string;
    matricula: string | null;
  }) => {
    if (record.unidad_id) {
      if (!unidadRecordsMap.has(record.unidad_id)) {
        unidadRecordsMap.set(record.unidad_id, record);
      }
    } else if (!fallbackUnidadRecord) {
      fallbackUnidadRecord = record;
    }
  };

  const unidadesRaw: unknown[] = Array.isArray(input?.unidades)
    ? input.unidades
    : Array.isArray(input?.units)
    ? input.units
    : [];
  unidadesRaw.forEach((unidad) => {
    if (!unidad || typeof unidad !== 'object') {
      return;
    }
    const id = toTrimmedString((unidad as any).unidad_id ?? (unidad as any).id);
    if (id) {
      unidadIdSet.add(id);
    }
    registerUnidadRecord({
      unidad_id: id ?? '',
      name: toTrimmedString((unidad as any).name) ?? '',
      matricula: toTrimmedString((unidad as any).matricula),
    });
  });

  if (input?.unidad && typeof input.unidad === 'object') {
    const id = toTrimmedString(input.unidad.unidad_id) ?? unidadId ?? null;
    if (id) {
      unidadIdSet.add(id);
    }
    registerUnidadRecord({
      unidad_id: id ?? '',
      name: toTrimmedString(input.unidad.name) ?? '',
      matricula: toTrimmedString(input.unidad.matricula),
    });
  }

  const unidadIds = Array.from(unidadIdSet);
  const unidades = Array.from(unidadRecordsMap.values());
  if (!unidades.length && fallbackUnidadRecord) {
    unidades.push(fallbackUnidadRecord);
  }

  const trainerInviteStatus = toTrainerInviteStatus(input?.trainer_invite_status);
  const trainerInviteStatusesRaw =
    input?.trainer_invite_statuses && typeof input.trainer_invite_statuses === 'object'
      ? (input.trainer_invite_statuses as Record<string, unknown>)
      : {};
  const trainerInviteStatuses: Record<string, TrainerInviteStatus> = {};
  Object.entries(trainerInviteStatusesRaw).forEach(([key, value]) => {
    const normalizedKey = toTrimmedString(key);
    if (!normalizedKey) return;
    trainerInviteStatuses[normalizedKey] = toTrainerInviteStatus(value);
  });

  const trainerInvitesRaw: unknown[] = Array.isArray(input?.trainer_invites) ? input.trainer_invites : [];
  const trainerInvites: VariantTrainerInvite[] = [];
  trainerInvitesRaw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const record = entry as Record<string, unknown>;
    const trainerId = toTrimmedString(record.trainer_id);
    const status = toTrainerInviteResponseStatus(record.status);
    if (!trainerId || !status) {
      return;
    }
    const sentAt = typeof record.sent_at === 'string' ? record.sent_at : null;
    const respondedAt = typeof record.responded_at === 'string' ? record.responded_at : null;
    trainerInvites.push({
      trainer_id: trainerId,
      status,
      sent_at: sentAt,
      responded_at: respondedAt,
    });
    trainerInviteStatuses[trainerId] = status;
  });

  return {
    id: String(input?.id ?? fallbackId),
    id_woo: input?.id_woo != null ? String(input.id_woo) : '',
    name: input?.name ?? null,
    status: input?.status ?? null,
    price: input?.price != null ? String(input.price) : null,
    stock: stockValue,
    stock_status: input?.stock_status ?? null,
    sede: input?.sede ?? null,
    date: input?.date ?? null,
    trainer_id: trainerIds[0] ?? trainerId ?? null,
    trainer: trainers.find((item) => item.trainer_id === (trainerIds[0] ?? trainerId ?? '')) ?? null,
    trainer_ids: trainerIds,
    trainers,
    trainer_invite_status: trainerInviteStatus,
    trainer_invite_statuses: trainerInviteStatuses,
    trainer_invites: trainerInvites,
    sala_id: salaId,
    sala:
  input?.sala && typeof input.sala === 'object'
    ? {
        // debe ser string siempre
        sala_id:
          input.sala.sala_id != null && String(input.sala.sala_id).trim().length
            ? String(input.sala.sala_id).trim()
            : (salaId ?? ''),
        name: toTrimmedString(input.sala.name) ?? '',
        sede: toTrimmedString(input.sala.sede),
      }
    : null,
    unidad_movil_id: unidadIds[0] ?? unidadId ?? null,
    unidad: unidades.find((item) => item.unidad_id === (unidadIds[0] ?? unidadId ?? '')) ?? null,
    unidad_movil_ids: unidadIds,
    unidades,
    created_at: input?.created_at ?? null,
    updated_at: input?.updated_at ?? null,
  } satisfies VariantInfo;
}

export function normalizeProductFromResponse(input: any): ProductInfo {
  const stockQuantity = toNumberOrNull(input?.default_variant_stock_quantity);
  const variantsRaw: unknown[] = Array.isArray(input?.variants) ? input.variants : [];

  const variants = variantsRaw.map((variant, index) =>
    normalizeVariantFromResponse(variant, `${input?.id ?? 'product'}-variant-${index}`),
  );

  return {
    id: String(input?.id ?? ''),
    id_woo: input?.id_woo != null ? String(input.id_woo) : null,
    name: input?.name ?? null,
    code: input?.code ?? null,
    category: input?.category ?? null,
    hora_inicio: input?.hora_inicio ?? null,
    hora_fin: input?.hora_fin ?? null,
    default_variant_start: input?.default_variant_start ?? null,
    default_variant_end: input?.default_variant_end ?? null,
    default_variant_stock_status: input?.default_variant_stock_status ?? null,
    default_variant_stock_quantity: stockQuantity,
    default_variant_price: input?.default_variant_price != null ? String(input.default_variant_price) : null,
    variants,
  } satisfies ProductInfo;
}

export function normalizeProductDefaults(input: any): ProductDefaults {
  const stockQuantity = toNumberOrNull(input?.default_variant_stock_quantity);

  return {
    default_variant_start: input?.default_variant_start ?? null,
    default_variant_end: input?.default_variant_end ?? null,
    default_variant_stock_status: input?.default_variant_stock_status ?? null,
    default_variant_stock_quantity: stockQuantity,
    default_variant_price: input?.default_variant_price != null ? String(input.default_variant_price) : null,
    hora_inicio: input?.hora_inicio ?? null,
    hora_fin: input?.hora_fin ?? null,
  } satisfies ProductDefaults;
}

function normalizeDealProductPrice(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  if (typeof value === 'object') {
    const record = value as { toNumber?: () => number; valueOf?: () => unknown; toString?: () => string };

    if (typeof record.toNumber === 'function') {
      try {
        const numeric = record.toNumber();
        if (Number.isFinite(numeric)) {
          return numeric.toString();
        }
      } catch (error) {
        console.warn('[normalizeDealProductPrice] could not convert decimal to number', error);
      }
    }

    if (typeof record.valueOf === 'function') {
      const primitive = record.valueOf();
      if (typeof primitive === 'number' && Number.isFinite(primitive)) {
        return primitive.toString();
      }
      if (typeof primitive === 'string') {
        const text = primitive.trim();
        if (text.length) {
          return text;
        }
      }
    }

    if (typeof record.toString === 'function') {
      const text = record.toString();
      if (text && text !== '[object Object]') {
        return text;
      }
    }
  }

  return null;
}

export function normalizeDealProducts(raw: unknown): DealProductInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const products: DealProductInfo[] = [];

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const item = entry as Record<string, any>;
    const price = normalizeDealProductPrice(item.price);
    const name = typeof item.name === 'string' ? item.name : null;
    const code = typeof item.code === 'string' ? item.code : null;
    const id =
      item.id != null && item.id !== ''
        ? String(item.id)
        : item.deal_product_id != null && item.deal_product_id !== ''
          ? String(item.deal_product_id)
          : `deal-product-${index}`;

    products.push({
      id,
      name,
      code,
      price,
    });
  });

  return products;
}

export function normalizeDealStudentsCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? 0 : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return 0;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed < 0 ? 0 : parsed;
    }
  }

  return 0;
}

export function normalizeDealTag(raw: any): DealTag | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const dealId = toTrimmedString((raw as any)?.deal_id ?? (raw as any)?.id) ?? '';
  if (!dealId) {
    return null;
  }

  const title = typeof (raw as any)?.title === 'string' ? (raw as any).title : null;
  if (!title) {
    return null;
  }

  const rawVariation = (raw as any)?.w_id_variation;
  const rawDate = (raw as any)?.a_fecha;
  const rawStudentsCount = (raw as any)?.students_count ?? (raw as any)?._count?.alumnos ?? null;

  const wIdVariation =
    typeof rawVariation === 'string'
      ? rawVariation
      : rawVariation != null
      ? String(rawVariation)
      : null;

  const trainingDate =
    typeof rawDate === 'string'
      ? rawDate
      : rawDate != null
      ? String(rawDate)
      : null;

  const studentsCount = normalizeDealStudentsCount(rawStudentsCount);

  const organizationName = toTrimmedString((raw as any)?.organization?.name);
  const organization = organizationName !== null ? { name: organizationName } : null;

  const personFirstName = toTrimmedString((raw as any)?.person?.first_name);
  const personLastName = toTrimmedString((raw as any)?.person?.last_name);
  const person =
    personFirstName !== null || personLastName !== null
      ? { first_name: personFirstName, last_name: personLastName }
      : null;

  const fundaeLabel = toTrimmedString((raw as any)?.fundae_label);
  const poValue = toTrimmedString((raw as any)?.po);

  return {
    deal_id: dealId,
    title,
    products: normalizeDealProducts((raw as any)?.products ?? (raw as any)?.deal_products ?? []),
    w_id_variation: wIdVariation,
    a_fecha: trainingDate,
    students_count: studentsCount,
    organization,
    person,
    fundae_label: fundaeLabel,
    po: poValue,
  } satisfies DealTag;
}

export function findDealProductPriceForProduct(deals: DealTag[], product: ProductInfo): string | null {
  const normalizedName = product.name?.trim().toLowerCase() ?? null;
  const normalizedCode = product.code?.trim().toLowerCase() ?? null;

  for (const deal of deals) {
    let fallbackPrice: string | null = null;

    for (const dealProduct of deal.products) {
      if (!dealProduct.price) {
        continue;
      }

      const productName = dealProduct.name?.trim().toLowerCase() ?? null;
      const productCode = dealProduct.code?.trim().toLowerCase() ?? null;

      if ((normalizedCode && productCode === normalizedCode) || (normalizedName && productName === normalizedName)) {
        return dealProduct.price;
      }

      if (!fallbackPrice) {
        fallbackPrice = dealProduct.price;
      }
    }

    if (fallbackPrice) {
      return fallbackPrice;
    }
  }

  return null;
}

export function extractVariantSortKey(variant: VariantInfo): VariantSortKey {
  const name = variant.name?.trim() ?? '';
  const dateMatch = name.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);

  let locationSegment = name;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  if (dateMatch) {
    const [, dayText, monthText, yearText] = dateMatch;
    const parsedDay = Number.parseInt(dayText ?? '', 10);
    const parsedMonth = Number.parseInt(monthText ?? '', 10);
    let parsedYear = Number.parseInt(yearText ?? '', 10);

    day = Number.isFinite(parsedDay) ? parsedDay : null;
    month = Number.isFinite(parsedMonth) ? parsedMonth : null;

    if (Number.isFinite(parsedYear)) {
      if (yearText && yearText.length === 2) {
        parsedYear += parsedYear < 50 ? 2000 : 1900;
      }
      year = parsedYear;
    }

    const index = dateMatch.index ?? -1;
    if (index >= 0) {
      locationSegment = name.slice(0, index);
    }
  }

  let location = locationSegment.replace(/[\s,.;:-]+$/u, '').trim();
  if (!location) {
    location = variant.sede?.trim() ?? '';
  }
  if (!location && name) {
    location = name;
  }

  return {
    location: location || null,
    year,
    month,
    day,
  } satisfies VariantSortKey;
}

function compareNullableStrings(a: string | null, b: string | null): number {
  const hasA = !!(a && a.trim().length);
  const hasB = !!(b && b.trim().length);
  if (hasA && hasB) {
    return a!.trim().localeCompare(b!.trim(), 'es', { sensitivity: 'base' });
  }
  if (hasA) return -1;
  if (hasB) return 1;
  return 0;
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareVariants(a: VariantInfo, b: VariantInfo): number {
  const keyA = extractVariantSortKey(a);
  const keyB = extractVariantSortKey(b);

  const locationCompare = compareNullableStrings(keyA.location, keyB.location);
  if (locationCompare !== 0) return locationCompare;

  const yearCompare = compareNullableNumbers(keyA.year, keyB.year);
  if (yearCompare !== 0) return yearCompare;

  const monthCompare = compareNullableNumbers(keyA.month, keyB.month);
  if (monthCompare !== 0) return monthCompare;

  const dayCompare = compareNullableNumbers(keyA.day, keyB.day);
  if (dayCompare !== 0) return dayCompare;

  return (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' });
}

function getVariantLocationLabel(variant: VariantInfo): string {
  const location = extractVariantSortKey(variant).location ?? variant.sede?.trim() ?? '';
  return location || 'Sin sede';
}

function getVariantMonthSortKey(variant: VariantInfo): { year: number | null; month: number | null } {
  const key = extractVariantSortKey(variant);
  let { year, month } = key;

  if ((year == null || month == null) && variant.date) {
    const parsed = new Date(variant.date);
    if (!Number.isNaN(parsed.getTime())) {
      if (year == null) {
        year = parsed.getFullYear();
      }
      if (month == null) {
        month = parsed.getMonth() + 1;
      }
    }
  }

  return { year: year ?? null, month: month ?? null };
}

function buildMonthLabel(sortKey: { year: number | null; month: number | null }): string {
  if (sortKey.month != null) {
    const monthIndex = Math.max(Math.min(sortKey.month - 1, 11), 0);
    const monthName = MONTH_NAMES[monthIndex] ?? `Mes ${sortKey.month}`;
    return sortKey.year != null ? `${monthName} ${sortKey.year}` : monthName;
  }

  if (sortKey.year != null) {
    return `${sortKey.year}`;
  }

  return 'Sin mes';
}

export function buildVariantGroups(variants: VariantInfo[]): VariantLocationGroup[] {
  const sortedVariants = [...variants].sort(compareVariants);
  const locationMap = new Map<string, VariantLocationGroup>();

  sortedVariants.forEach((variant) => {
    const locationLabel = getVariantLocationLabel(variant);
    const locationKey = locationLabel.trim().toLocaleLowerCase('es') || 'default';
    const locationGroup = locationMap.get(locationKey) ?? {
      key: locationKey,
      label: locationLabel,
      variantsByMonth: [],
      totalVariants: 0,
    };

    const monthSortKey = getVariantMonthSortKey(variant);
    const monthKey = `${monthSortKey.year ?? 'unknown'}-${monthSortKey.month ?? 'unknown'}`;
    let monthGroup = locationGroup.variantsByMonth.find((group) => group.key === monthKey);

    if (!monthGroup) {
      monthGroup = {
        key: monthKey,
        label: buildMonthLabel(monthSortKey),
        sortYear: monthSortKey.year,
        sortMonth: monthSortKey.month,
        variants: [],
      } satisfies VariantMonthGroup;
      locationGroup.variantsByMonth.push(monthGroup);
    }

    monthGroup.variants.push(variant);
    monthGroup.variants.sort(compareVariants);
    locationGroup.totalVariants += 1;

    locationGroup.variantsByMonth.sort((a, b) => {
      const yearCompare = compareNullableNumbers(a.sortYear, b.sortYear);
      if (yearCompare !== 0) return yearCompare;
      return compareNullableNumbers(a.sortMonth, b.sortMonth);
    });

    locationMap.set(locationKey, locationGroup);
  });

  const groups = Array.from(locationMap.values());
  groups.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
  return groups;
}
