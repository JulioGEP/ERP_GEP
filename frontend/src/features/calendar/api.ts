// frontend/src/features/calendar/api.ts
import { API_BASE, ApiError } from "../../api/client";
import type { SessionEstado } from "../../api/sessions.types";

export type CalendarVariantProduct = {
  id: string;
  id_woo: string | null;
  name: string | null;
  code: string | null;
  template: string | null;
  category: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  default_variant_start: string | null;
  default_variant_end: string | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: string | null;
};

export type CalendarVariantDetails = {
  id: string;
  id_woo: string | null;
  parent_woo_id: string | null;
  name: string | null;
  status: string | null;
  finalizar: string | null;
  price: string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: string | null;
  trainer_id: string | null;
  trainer: { trainer_id: string; name: string | null; apellido: string | null; dni: string | null } | null;
  trainer_ids: string[];
  trainers: Array<{ trainer_id: string; name: string | null; apellido: string | null; dni: string | null }>;
  sala_id: string | null;
  sala: { sala_id: string | null; name: string | null; sede: string | null } | null;
  unidad_movil_id: string | null;
  unidad: { unidad_id: string; name: string | null; matricula: string | null } | null;
  unidad_movil_ids: string[];
  unidades: Array<{ unidad_id: string; name: string | null; matricula: string | null }>;
  students_total: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CalendarVariantDeal = {
  id: string | null;
  title: string | null;
  pipelineId: string | null;
  trainingAddress: string | null;
  sedeLabel: string | null;
  caesLabel: string | null;
  fundaeLabel: string | null;
  hotelLabel: string | null;
  transporte: string | null;
  organizationName: string | null;
};

export type CalendarVariantEvent = {
  id: string;
  start: string;
  end: string;
  product: CalendarVariantProduct;
  variant: CalendarVariantDetails;
  deals: CalendarVariantDeal[];
};

export type CalendarResource = {
  id: string;
  name: string;
  secondary?: string | null;
};

export type CalendarTrainer = CalendarResource;
export type CalendarUnit = CalendarResource;

export type CalendarSessionStudent = {
  id: string | null;
  nombre: string | null;
  apellido: string | null;
  dni: string | null;
};

export type CalendarSession = {
  id: string;
  dealId: string;
  dealTitle: string | null;
  dealOrganizationName: string | null;
  dealAddress: string | null;
  dealSedeLabel: string | null;
  dealPipelineId: string | null;
  dealCaesLabel: string | null;
  dealFundaeLabel: string | null;
  dealHotelLabel: string | null;
  dealTransporte: string | null;
  productId: string;
  productName: string | null;
  productCode: string | null;
  title: string;
  start: string;
  end: string;
  estado: SessionEstado;
  direccion: string | null;
  comentarios: string | null;
  room: CalendarResource | null;
  trainers: CalendarTrainer[];
  units: CalendarUnit[];
  studentsTotal: number | null;
  students: CalendarSessionStudent[];
  studentNames: string[];
};

export type CalendarSessionsParams = {
  start: string;
  end: string;
  dealId?: string;
  productId?: string;
  roomId?: string;
  trainerId?: string;
  unitId?: string;
  estados?: SessionEstado[];
};

export type CalendarSessionsResponse = {
  range: { start: string; end: string };
  sessions: CalendarSession[];
};

export type CalendarVariantsParams = {
  start: string;
  end: string;
  trainerId?: string;
};

export type CalendarVariantsResponse = {
  range: { start: string; end: string };
  variants: CalendarVariantEvent[];
};

const SESSION_ESTADO_VALUES: SessionEstado[] = [
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
];

function toTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.trim().length ? text : null;
}

function toSessionEstado(value: unknown): SessionEstado {
  const text = toTrimmed(value);
  if (!text) return 'BORRADOR';
  const normalized = text.toUpperCase();
  return SESSION_ESTADO_VALUES.includes(normalized as SessionEstado)
    ? (normalized as SessionEstado)
    : 'BORRADOR';
}

function toResource(value: any): CalendarResource | null {
  const id = toTrimmed(value?.id ?? value?.sala_id ?? value?.trainer_id ?? value?.unidad_id);
  const name = toTrimmed(value?.name);
  if (!id || !name) return null;
  const secondary = toOptionalString(value?.sede ?? value?.apellido ?? value?.matricula ?? value?.secondary);
  return { id, name, secondary };
}

function ensureUniqueResources(resources: (CalendarResource | null)[]): CalendarResource[] {
  const seen = new Set<string>();
  const output: CalendarResource[] = [];
  resources.forEach((resource) => {
    if (!resource) return;
    if (seen.has(resource.id)) return;
    seen.add(resource.id);
    output.push(resource);
  });
  return output;
}

function sanitizeSessionStudent(input: any): CalendarSessionStudent | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const id = toTrimmed(input?.id);
  const nombre = toTrimmed(input?.nombre);
  const apellido = toTrimmed(input?.apellido);
  const dni = toTrimmed(input?.dni);

  if (!id && !nombre && !apellido && !dni) {
    return null;
  }

  return { id, nombre, apellido, dni } satisfies CalendarSessionStudent;
}

function buildStudentNames(students: CalendarSessionStudent[]): string[] {
  return students
    .map((student) => {
      const combined = [student.nombre ?? '', student.apellido ?? '']
        .map((part) => part.trim())
        .filter((part) => part.length)
        .join(' ')
        .trim();
      if (combined.length) {
        return combined;
      }
      return student.dni ?? '';
    })
    .filter((value) => value.length);
}

function sanitizeVariantProduct(input: any): CalendarVariantProduct | null {
  const id = toTrimmed(input?.id);
  if (!id) return null;

  const resolveString = (value: unknown) => toOptionalString(value);

  return {
    id,
    id_woo: toOptionalString(input?.id_woo),
    name: toOptionalString(input?.name),
    code: toOptionalString(input?.code ?? input?.codigo),
    template: resolveString(input?.template),
    category: toOptionalString(input?.category ?? input?.categoria),
    hora_inicio: resolveString(input?.hora_inicio ?? input?.horaInicio),
    hora_fin: resolveString(input?.hora_fin ?? input?.horaFin),
    default_variant_start: resolveString(
      input?.default_variant_start ?? input?.variant_start ?? input?.variantStart,
    ),
    default_variant_end: resolveString(
      input?.default_variant_end ?? input?.variant_end ?? input?.variantEnd,
    ),
    default_variant_stock_status: resolveString(
      input?.default_variant_stock_status ?? input?.variant_stock_status ?? input?.variantStockStatus,
    ),
    default_variant_stock_quantity:
      typeof input?.default_variant_stock_quantity === 'number'
        ? input.default_variant_stock_quantity
        : input?.default_variant_stock_quantity != null && !Number.isNaN(Number(input.default_variant_stock_quantity))
          ? Number(input.default_variant_stock_quantity)
          : null,
    default_variant_price: toOptionalString(input?.default_variant_price ?? input?.variant_price ?? input?.variantPrice),
  } satisfies CalendarVariantProduct;
}

function sanitizeVariantDetails(input: any): CalendarVariantDetails | null {
  const id = toTrimmed(input?.id);
  if (!id) return null;

  const trainerIdSet = new Set<string>();
  const trainerRecordsMap = new Map<
    string,
    { trainer_id: string; name: string | null; apellido: string | null; dni: string | null }
  >();
  let fallbackTrainerRecord:
    | { trainer_id: string; name: string | null; apellido: string | null; dni: string | null }
    | null = null;

  const registerTrainerId = (value: unknown) => {
    const normalized = toTrimmed(value);
    if (normalized) {
      trainerIdSet.add(normalized);
    }
  };

  const registerTrainerRecord = (record: any) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    const trainerId = toTrimmed(
      record?.trainer_id ?? record?.trainerId ?? record?.id ?? record?.trainer,
    );
    if (!trainerId) {
      if (!fallbackTrainerRecord) {
        fallbackTrainerRecord = {
          trainer_id: '',
          name: toOptionalString(record?.name ?? record?.nombre),
          apellido: toOptionalString(record?.apellido ?? record?.apellidos),
          dni: toOptionalString(record?.dni),
        };
      }
      return;
    }
    if (!trainerRecordsMap.has(trainerId)) {
      trainerRecordsMap.set(trainerId, {
        trainer_id: trainerId,
        name: toOptionalString(record?.name ?? record?.nombre),
        apellido: toOptionalString(record?.apellido ?? record?.apellidos),
        dni: toOptionalString(record?.dni),
      });
    }
    trainerIdSet.add(trainerId);
  };

  registerTrainerId(input?.trainer_id ?? input?.trainerId);
  const trainerIdsRaw: unknown[] = Array.isArray(input?.trainer_ids)
    ? input.trainer_ids
    : Array.isArray(input?.trainerIds)
    ? input.trainerIds
    : [];
  trainerIdsRaw.forEach((value) => registerTrainerId(value));
  const trainersRaw: unknown[] = Array.isArray(input?.trainers)
    ? input.trainers
    : Array.isArray(input?.trainer_records)
    ? input.trainer_records
    : [];
  trainersRaw.forEach((trainer) => registerTrainerRecord(trainer));
  if (input?.trainer && typeof input.trainer === 'object') {
    registerTrainerRecord(input.trainer);
  }
  if (input?.primary_trainer && typeof input.primary_trainer === 'object') {
    registerTrainerRecord(input.primary_trainer);
  }

  const orderedTrainerIds = Array.from(trainerIdSet);
  const trainerRecords: Array<{
    trainer_id: string;
    name: string | null;
    apellido: string | null;
    dni: string | null;
  }> = [];
  orderedTrainerIds.forEach((value) => {
    const record = trainerRecordsMap.get(value);
    if (record) {
      trainerRecords.push(record);
    } else {
      trainerRecords.push({ trainer_id: value, name: null, apellido: null, dni: null });
    }
  });
  trainerRecordsMap.forEach((record, key) => {
    if (!orderedTrainerIds.includes(key)) {
      trainerRecords.push(record);
    }
  });
  if (!trainerRecords.length && fallbackTrainerRecord) {
    trainerRecords.push(fallbackTrainerRecord);
  }
  const primaryTrainer = trainerRecords[0] ?? null;
  const trainerId = primaryTrainer?.trainer_id ?? orderedTrainerIds[0] ?? null;

  const unitIdSet = new Set<string>();
  const unitRecordsMap = new Map<string, { unidad_id: string; name: string | null; matricula: string | null }>();
  let fallbackUnitRecord: { unidad_id: string; name: string | null; matricula: string | null } | null = null;

  const registerUnitId = (value: unknown) => {
    const normalized = toTrimmed(value);
    if (normalized) {
      unitIdSet.add(normalized);
    }
  };

  const registerUnitRecord = (record: any) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    const unidadId = toTrimmed(
      record?.unidad_id ??
        record?.unidadId ??
        record?.id ??
        record?.unit_id ??
        record?.unitId ??
        record?.unidad,
    );
    if (!unidadId) {
      if (!fallbackUnitRecord) {
        fallbackUnitRecord = {
          unidad_id: '',
          name: toOptionalString(record?.name ?? record?.nombre),
          matricula: toOptionalString(record?.matricula ?? record?.licensePlate),
        };
      }
      return;
    }
    if (!unitRecordsMap.has(unidadId)) {
      unitRecordsMap.set(unidadId, {
        unidad_id: unidadId,
        name: toOptionalString(record?.name ?? record?.nombre),
        matricula: toOptionalString(record?.matricula ?? record?.licensePlate),
      });
    }
    unitIdSet.add(unidadId);
  };

  registerUnitId(
    input?.unidad_movil_id ??
      input?.unidadMovilId ??
      input?.unit_id ??
      input?.unitId ??
      input?.unidad_id ??
      input?.unidadId,
  );
  const unidadIdsRaw: unknown[] = Array.isArray(input?.unidad_movil_ids)
    ? input.unidad_movil_ids
    : Array.isArray(input?.unidadMovilIds)
    ? input.unidadMovilIds
    : Array.isArray(input?.unit_ids)
    ? input.unit_ids
    : Array.isArray(input?.unitIds)
    ? input.unitIds
    : [];
  unidadIdsRaw.forEach((value) => registerUnitId(value));
  const unidadesRaw: unknown[] = Array.isArray(input?.unidades)
    ? input.unidades
    : Array.isArray(input?.units)
    ? input.units
    : [];
  unidadesRaw.forEach((unit) => registerUnitRecord(unit));
  if (input?.unidad && typeof input.unidad === 'object') {
    registerUnitRecord(input.unidad);
  }
  if (input?.unidad_movil && typeof input.unidad_movil === 'object') {
    registerUnitRecord(input.unidad_movil);
  }
  if (input?.unit && typeof input.unit === 'object') {
    registerUnitRecord(input.unit);
  }

  const orderedUnitIds = Array.from(unitIdSet);
  const unitRecords: Array<{ unidad_id: string; name: string | null; matricula: string | null }> = [];
  orderedUnitIds.forEach((value) => {
    const record = unitRecordsMap.get(value);
    if (record) {
      unitRecords.push(record);
    } else {
      unitRecords.push({ unidad_id: value, name: null, matricula: null });
    }
  });
  unitRecordsMap.forEach((record, key) => {
    if (!orderedUnitIds.includes(key)) {
      unitRecords.push(record);
    }
  });
  if (!unitRecords.length && fallbackUnitRecord) {
    unitRecords.push(fallbackUnitRecord);
  }
  const primaryUnit = unitRecords[0] ?? null;
  const unidadId = primaryUnit?.unidad_id ?? orderedUnitIds[0] ?? null;

  const salaId = toOptionalString(input?.sala_id ?? input?.room_id ?? input?.salaId ?? input?.roomId);
  const salaRecord =
    input?.sala && typeof input.sala === 'object'
      ? input.sala
      : input?.room && typeof input.room === 'object'
      ? input.room
      : null;

  const finalizar = toOptionalString(input?.finalizar) ?? 'Activa';

  return {
  id,
  id_woo: toOptionalString(input?.id_woo),
  parent_woo_id: toOptionalString(input?.parent_woo_id ?? input?.parentWooId ?? input?.id_padre),
  name: toOptionalString(input?.name),
  status: toOptionalString(input?.status),
    finalizar,
    price: toOptionalString(input?.price),
    stock:
      typeof input?.stock === 'number'
        ? input.stock
        : input?.stock != null && !Number.isNaN(Number(input.stock))
          ? Number(input.stock)
          : null,
    stock_status: toOptionalString(input?.stock_status ?? input?.stockStatus),
    sede: toOptionalString(input?.sede),
    date: toOptionalString(input?.date),
    trainer_id: trainerId,
    trainer: primaryTrainer,
    trainer_ids: trainerRecords.map((record) => record.trainer_id),
    trainers: trainerRecords,
    sala_id: salaId,
    sala:
      salaRecord && typeof salaRecord === 'object'
        ? {
            sala_id: toOptionalString(salaRecord?.sala_id ?? salaRecord?.id ?? salaId) ?? salaId,
            name: toOptionalString(salaRecord?.name ?? salaRecord?.nombre),
            sede: toOptionalString(salaRecord?.sede ?? salaRecord?.location),
          }
        : null,
    unidad_movil_id: unidadId,
    unidad: primaryUnit,
    unidad_movil_ids: unitRecords.map((record) => record.unidad_id),
    unidades: unitRecords,
    students_total:
      typeof input?.students_total === 'number'
        ? input.students_total
        : input?.students_total != null && !Number.isNaN(Number(input.students_total))
          ? Number(input.students_total)
          : null,
    created_at: toOptionalString(input?.created_at),
    updated_at: toOptionalString(input?.updated_at),
  } satisfies CalendarVariantDetails;
}

function sanitizeVariantDeals(payload: any): CalendarVariantDeal[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => {
      const id = toTrimmed(item?.id ?? item?.deal_id);
      const title = toTrimmed(item?.title);
      const pipelineId = toTrimmed(item?.pipeline_id);
      const trainingAddress = toTrimmed(item?.training_address);
      const sedeLabel = toTrimmed(item?.sede_label);
      const caesLabel = toTrimmed(item?.caes_label);
      const fundaeLabel = toTrimmed(item?.fundae_label);
      const hotelLabel = toTrimmed(item?.hotel_label);
      const transporte = toTrimmed(item?.transporte);
      const organizationName = toTrimmed(
        item?.organization_name ?? item?.organizationName ?? item?.deal_organization_name,
      );

      if (
        !id &&
        !title &&
        !pipelineId &&
        !trainingAddress &&
        !sedeLabel &&
        !caesLabel &&
        !fundaeLabel &&
        !hotelLabel &&
        !transporte &&
        !organizationName
      ) {
        return null;
      }

      return {
        id,
        title,
        pipelineId,
        trainingAddress,
        sedeLabel,
        caesLabel,
        fundaeLabel,
        hotelLabel,
        transporte,
        organizationName,
      } satisfies CalendarVariantDeal;
    })
    .filter((deal): deal is CalendarVariantDeal => deal !== null);
}

function sanitizeVariantsPayload(payload: any[]): CalendarVariantEvent[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const id = toTrimmed(row?.id);
      const start = toTrimmed(row?.start);
      const end = toTrimmed(row?.end);
      if (!id || !start || !end) return null;

      const product = sanitizeVariantProduct(row?.product);
      const variant = sanitizeVariantDetails(row?.variant);
      if (!product || !variant) return null;

      return {
        id,
        start,
        end,
        product,
        variant,
        deals: sanitizeVariantDeals(row?.deals),
      } satisfies CalendarVariantEvent;
    })
    .filter((variant): variant is CalendarVariantEvent => variant !== null);
}

function sanitizeSessionsPayload(payload: any[]): CalendarSession[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const id = toTrimmed(row?.id);
      const start = toTrimmed(row?.fecha_inicio_utc);
      const end = toTrimmed(row?.fecha_fin_utc);
      const title = toTrimmed(row?.nombre_cache) ?? 'Sesión';
      if (!id || !start || !end) return null;

      const room = row?.sala ? toResource({ ...row.sala, id: row.sala.sala_id }) : null;
      const trainers = ensureUniqueResources(
        Array.isArray(row?.trainers)
          ? row.trainers.map((trainer: any) =>
              toResource({
                id: trainer?.trainer_id,
                name: trainer?.name,
                secondary: trainer?.apellido,
              }),
            )
          : [],
      );

      const units = ensureUniqueResources(
        Array.isArray(row?.unidades)
          ? row.unidades.map((unit: any) =>
              toResource({
                id: unit?.unidad_id,
                name: unit?.name,
                secondary: unit?.matricula,
              }),
            )
          : [],
      );

      const students = Array.isArray(row?.students)
        ? (row.students as unknown[])
            .map((student: unknown) => sanitizeSessionStudent(student))
            .filter(
              (student: CalendarSessionStudent | null): student is CalendarSessionStudent =>
                student !== null,
            )
        : [];

      const studentNames = buildStudentNames(students);

      let studentsTotal =
        typeof row?.students_total === 'number'
          ? row.students_total
          : row?.students_total != null && !Number.isNaN(Number(row.students_total))
            ? Number(row.students_total)
            : null;
      if (studentsTotal === null && students.length) {
        studentsTotal = students.length;
      }

      return {
        id,
        dealId: toTrimmed(row?.deal_id) ?? '',
        dealTitle: toOptionalString(row?.deal_title),
        dealOrganizationName: toOptionalString(
          row?.deal_organization_name ?? row?.organization_name ?? row?.organizationName,
        ),
        dealAddress: toOptionalString(row?.deal_training_address),
        dealSedeLabel: toOptionalString(row?.deal_sede_label),
        dealPipelineId: toOptionalString(row?.deal_pipeline_id),
        dealCaesLabel: toOptionalString(row?.deal_caes_label),
        dealFundaeLabel: toOptionalString(row?.deal_fundae_label),
        dealHotelLabel: toOptionalString(row?.deal_hotel_label),
        dealTransporte: toOptionalString(row?.deal_transporte),
        productId: toTrimmed(row?.deal_product_id) ?? '',
        productName: toOptionalString(row?.product_name),
        productCode: toOptionalString(row?.product_code),
        title,
        start,
        end,
        estado: toSessionEstado(row?.estado),
        direccion: toOptionalString(row?.direccion),
        comentarios: toOptionalString(row?.comentarios),
        room,
        trainers,
        units,
        studentsTotal,
        students,
        studentNames,
      } satisfies CalendarSession;
    })
    .filter((session): session is CalendarSession => session !== null);
}

function buildQuery(params: CalendarSessionsParams): string {
  const search = new URLSearchParams();
  search.set('start', params.start);
  search.set('end', params.end);
  if (params.dealId) search.set('dealId', params.dealId);
  if (params.productId) search.set('productId', params.productId);
  if (params.roomId) search.set('roomId', params.roomId);
  if (params.trainerId) search.set('trainerId', params.trainerId);
  if (params.unitId) search.set('unitId', params.unitId);
  if (params.estados?.length) search.set('estado', params.estados.join(','));
  return search.toString();
}

function fetchWithClient(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      'X-ERP-Client': 'frontend',
      ...(init?.headers || {}),
    },
  });
}

export async function fetchCalendarSessions(
  params: CalendarSessionsParams,
): Promise<CalendarSessionsResponse> {
  const query = buildQuery(params);
  let response: Response;
  try {
    response = await fetchWithClient(`${API_BASE}/sessions/range?${query}`);
  } catch (error: any) {
    throw new ApiError('NETWORK_ERROR', error?.message ?? 'Fallo de red');
  }

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    /* cuerpo vacío */
  }

  if (!response.ok || payload?.ok === false) {
    const code = payload?.error_code ?? payload?.code ?? `HTTP_${response.status}`;
    const message = payload?.message ?? 'Error inesperado en la carga del calendario';
    throw new ApiError(code, message, response.status);
  }

  const rangeStart = toTrimmed(payload?.range?.start);
  const rangeEnd = toTrimmed(payload?.range?.end);
  const sessions = sanitizeSessionsPayload(payload?.sessions ?? payload?.sesiones);

  return {
    range: {
      start: rangeStart ?? params.start,
      end: rangeEnd ?? params.end,
    },
    sessions,
  };
}

export async function fetchCalendarVariants(
  params: CalendarVariantsParams,
): Promise<CalendarVariantsResponse> {
  const search = new URLSearchParams();
  search.set('start', params.start);
  search.set('end', params.end);
  if (params.trainerId) {
    search.set('trainerId', params.trainerId);
  }

  let response: Response;
  try {
    response = await fetchWithClient(`${API_BASE}/calendar-variants?${search.toString()}`);
  } catch (error: any) {
    throw new ApiError('NETWORK_ERROR', error?.message ?? 'Fallo de red');
  }

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    /* cuerpo vacío */
  }

  if (!response.ok || payload?.ok === false) {
    const code = payload?.error_code ?? payload?.code ?? `HTTP_${response.status}`;
    const message = payload?.message ?? 'Error inesperado en la carga del calendario';
    throw new ApiError(code, message, response.status);
  }

  const rangeStart = toTrimmed(payload?.range?.start);
  const rangeEnd = toTrimmed(payload?.range?.end);
  const variants = sanitizeVariantsPayload(payload?.variants);

  return {
    range: {
      start: rangeStart ?? params.start,
      end: rangeEnd ?? params.end,
    },
    variants,
  } satisfies CalendarVariantsResponse;
}
