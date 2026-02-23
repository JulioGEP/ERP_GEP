// frontend/src/features/recursos/api.ts
import { API_BASE, ApiError } from "../../api/client";
import type { PayrollExpensePayload } from "../../api/userDocuments";
import type { Trainer, TrainerDocument } from "../../types/trainer";
import { SEDE_OPTIONS, type TrainerDocumentTypeValue } from "./trainers.constants";

export type TrainerPayload = {
  trainer_id?: string | null;
  name?: string | null;
  apellido?: string | null;
  email?: string | null;
  phone?: string | null;
  dni?: string | null;
  direccion?: string | null;
  especialidad?: string | null;
  titulacion?: string | null;
  contrato_fijo?: boolean | null;
  nomina?: number | null;
  irpf?: number | null;
  ss?: number | null;
  horas_contratadas?: number | null;
  activo?: boolean | null;
  sede?: string[] | null;
  revision_medica_caducidad?: string | null;
  epis_caducidad?: string | null;
  dni_caducidad?: string | null;
  carnet_conducir_caducidad?: string | null;
  certificado_bombero_caducidad?: string | null;
};

type TrainerListResponse = {
  ok: boolean;
  trainers?: unknown;
  message?: string;
  error_code?: string;
};

type TrainerMutationResponse = {
  ok: boolean;
  trainer?: unknown;
  message?: string;
  error_code?: string;
};

type TrainerDocumentsListResponse = {
  ok: boolean;
  documents?: unknown;
  drive_folder_web_view_link?: unknown;
  message?: string;
  error_code?: string;
};

type TrainerDocumentMutationResponse = {
  ok: boolean;
  document?: unknown;
  drive_folder_web_view_link?: unknown;
  message?: string;
  error_code?: string;
};

function parseJson(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError("INVALID_RESPONSE", "Respuesta JSON inválida del servidor");
  }
}

function normalizeTrainerDocument(row: any): TrainerDocument {
  if (!row || typeof row !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de documento de formador no válido");
  }

  const document: TrainerDocument = {
    id: String(row.id ?? row.document_id ?? ""),
    trainer_id: String(row.trainer_id ?? ""),
    document_type: String(row.document_type ?? row.type ?? ""),
    document_type_label: row.document_type_label ?? row.documentTypeLabel ?? null,
    file_name: row.file_name ?? row.fileName ?? null,
    original_file_name: row.original_file_name ?? row.originalFileName ?? null,
    mime_type: row.mime_type ?? row.mimeType ?? null,
    file_size:
      typeof row.file_size === "number"
        ? row.file_size
        : typeof row.fileSize === "number"
          ? row.fileSize
          : null,
    drive_file_id: row.drive_file_id ?? row.driveFileId ?? null,
    drive_file_name: row.drive_file_name ?? row.driveFileName ?? null,
    drive_web_view_link: row.drive_web_view_link ?? row.driveWebViewLink ?? null,
    uploaded_at:
      row.uploaded_at instanceof Date
        ? row.uploaded_at.toISOString()
        : row.uploaded_at ?? null,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at ?? null,
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at ?? null,
  };

  return document;
}

function normalizeTrainer(row: any): Trainer {
  if (!row || typeof row !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de formador no válido");
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null;
  const revisionMedicaCaducidad =
    row.revision_medica_caducidad instanceof Date
      ? row.revision_medica_caducidad.toISOString()
      : row.revision_medica_caducidad ?? null;
  const episCaducidad =
    row.epis_caducidad instanceof Date ? row.epis_caducidad.toISOString() : row.epis_caducidad ?? null;
  const dniCaducidad =
    row.dni_caducidad instanceof Date ? row.dni_caducidad.toISOString() : row.dni_caducidad ?? null;
  const carnetConducirCaducidad =
    row.carnet_conducir_caducidad instanceof Date
      ? row.carnet_conducir_caducidad.toISOString()
      : row.carnet_conducir_caducidad ?? null;
  const certificadoBomberoCaducidad =
    row.certificado_bombero_caducidad instanceof Date
      ? row.certificado_bombero_caducidad.toISOString()
      : row.certificado_bombero_caducidad ?? null;
  const nominaValue =
    row.nomina === null || row.nomina === undefined ? null : Number.parseFloat(String(row.nomina));
  const irpfValue =
    row.irpf === null || row.irpf === undefined ? null : Number.parseFloat(String(row.irpf));
  const ssValue = row.ss === null || row.ss === undefined ? null : Number.parseFloat(String(row.ss));
  const horasContratadasValue =
    row.horas_contratadas === null || row.horas_contratadas === undefined
      ? null
      : Number.parseFloat(String(row.horas_contratadas));

  return {
    trainer_id: String(row.trainer_id ?? row.id ?? ""),
    name: String(row.name ?? ""),
    apellido: row.apellido ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    dni: row.dni ?? null,
    direccion: row.direccion ?? null,
    especialidad: row.especialidad ?? null,
    titulacion: row.titulacion ?? null,
    revision_medica_caducidad: revisionMedicaCaducidad,
    epis_caducidad: episCaducidad,
    dni_caducidad: dniCaducidad,
    carnet_conducir_caducidad: carnetConducirCaducidad,
    certificado_bombero_caducidad: certificadoBomberoCaducidad,
    contrato_fijo: Boolean(row.contrato_fijo ?? false),
    nomina: Number.isNaN(nominaValue) ? null : nominaValue,
    irpf: Number.isNaN(irpfValue) ? null : irpfValue,
    ss: Number.isNaN(ssValue) ? null : ssValue,
    horas_contratadas: Number.isNaN(horasContratadasValue) ? null : horasContratadasValue,
    activo: Boolean(row.activo ?? false),
    sede: Array.isArray(row.sede)
      ? row.sede.filter((value: unknown): value is string => typeof value === "string")
      : [],
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function buildRequestBody(payload: TrainerPayload): Record<string, any> {
  const body: Record<string, any> = {};

  if ("trainer_id" in payload) {
    const value = toNullableString(payload.trainer_id);
    if (value) body.trainer_id = value;
  }

  if ("name" in payload) {
    const value = toNullableString(payload.name);
    body.name = value;
  }

  const fields: Array<keyof TrainerPayload> = [
    "apellido",
    "email",
    "phone",
    "dni",
    "direccion",
    "especialidad",
    "titulacion",
  ];

  for (const field of fields) {
    if (field in payload) {
      body[field] = toNullableString(payload[field as keyof TrainerPayload]);
    }
  }

  const dateFields: Array<keyof TrainerPayload> = [
    "revision_medica_caducidad",
    "epis_caducidad",
    "dni_caducidad",
    "carnet_conducir_caducidad",
    "certificado_bombero_caducidad",
  ];

  for (const field of dateFields) {
    if (field in payload) {
      const value = toNullableString(payload[field]);
      body[field] = value;
    }
  }

  if ("activo" in payload) {
    body.activo = Boolean(payload.activo);
  }

  if ("contrato_fijo" in payload) {
    body.contrato_fijo = Boolean(payload.contrato_fijo);
  }

  if ("nomina" in payload) {
    const salary = payload.nomina;
    if (typeof salary === "number" && Number.isFinite(salary)) {
      body.nomina = salary;
    } else if (salary === null) {
      body.nomina = null;
    }
  }

  if ("irpf" in payload) {
    const value = payload.irpf;
    if (typeof value === "number" && Number.isFinite(value)) {
      body.irpf = value;
    } else if (value === null) {
      body.irpf = null;
    }
  }

  if ("ss" in payload) {
    const value = payload.ss;
    if (typeof value === "number" && Number.isFinite(value)) {
      body.ss = value;
    } else if (value === null) {
      body.ss = null;
    }
  }

  if ("horas_contratadas" in payload) {
    const value = payload.horas_contratadas;
    if (typeof value === "number" && Number.isFinite(value)) {
      body.horas_contratadas = value;
    } else if (value === null) {
      body.horas_contratadas = null;
    }
  }

  if ("sede" in payload) {
    const rawValues = Array.isArray(payload.sede) ? payload.sede : [];
    const values: string[] = [];
    for (const raw of rawValues) {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value.length) continue;
      if (!SEDE_OPTIONS.includes(value as (typeof SEDE_OPTIONS)[number])) continue;
      if (!values.includes(value)) {
        values.push(value);
      }
    }
    body.sede = values;
  }

  return body;
}

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const finalInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-ERP-Client': 'frontend',
      ...(init?.headers || {}),
    },
  };

  const response = await fetch(input, finalInit);
  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.ok === false) {
    const code = json?.error_code ?? `HTTP_${response.status}`;
    const message = json?.message ?? "Error inesperado en la solicitud";
    throw new ApiError(code, message, response.status);
  }

  return json;
}

export async function fetchTrainers(): Promise<Trainer[]> {
  const json = (await requestJson(`${API_BASE}/trainers`)) as TrainerListResponse;
  const rows = Array.isArray(json.trainers) ? json.trainers : [];
  return rows.map((row) => normalizeTrainer(row));
}

export async function createTrainer(payload: TrainerPayload): Promise<Trainer> {
  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/trainers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as TrainerMutationResponse;

  return normalizeTrainer(json.trainer);
}

export async function updateTrainer(trainerId: string, payload: TrainerPayload): Promise<Trainer> {
  if (!trainerId) {
    throw new ApiError("VALIDATION_ERROR", "trainer_id requerido para actualizar");
  }

  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/trainers/${encodeURIComponent(trainerId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as TrainerMutationResponse;

  return normalizeTrainer(json.trainer);
}

export async function fetchTrainerDocuments(trainerId: string): Promise<{
  documents: TrainerDocument[];
  driveFolderWebViewLink: string | null;
}> {
  if (!trainerId) {
    throw new ApiError("VALIDATION_ERROR", "trainerId es obligatorio");
  }

  const url = `${API_BASE}/trainer_documents?trainerId=${encodeURIComponent(trainerId)}`;
  const json = (await requestJson(url)) as TrainerDocumentsListResponse;
  const rows = Array.isArray(json.documents) ? json.documents : [];

  const documents = rows.map((row) => normalizeTrainerDocument(row));
  const linkValue = json.drive_folder_web_view_link;
  const driveFolderWebViewLink =
    typeof linkValue === "string" && linkValue.trim().length ? linkValue : null;

  return { documents, driveFolderWebViewLink };
}

export async function uploadTrainerDocument(input: {
  trainerId: string;
  documentType: TrainerDocumentTypeValue;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  contentBase64: string;
  payrollExpense?: PayrollExpensePayload | null;
}): Promise<{ document: TrainerDocument; driveFolderWebViewLink: string | null }> {
  const body = {
    trainer_id: input.trainerId,
    document_type: input.documentType,
    file: {
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize ?? undefined,
      contentBase64: input.contentBase64,
    },
    payrollExpense: input.payrollExpense ?? undefined,
  };

  const json = (await requestJson(`${API_BASE}/trainer_documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as TrainerDocumentMutationResponse;

  const document = normalizeTrainerDocument(json.document);
  const linkValue = json.drive_folder_web_view_link;
  const driveFolderWebViewLink =
    typeof linkValue === "string" && linkValue.trim().length ? linkValue : null;

  return { document, driveFolderWebViewLink };
}

export async function deleteTrainerDocument(documentId: string): Promise<void> {
  if (!documentId) {
    throw new ApiError("VALIDATION_ERROR", "documentId es obligatorio");
  }

  await requestJson(`${API_BASE}/trainer_documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}
