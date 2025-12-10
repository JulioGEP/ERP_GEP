import { ApiError, normalizeDriveUrlInput, requestJson, toStringValue } from '../../../api/client';
import { normalizePublicSessionInfo, normalizeSessionStudent } from './normalizers';
import type { PublicSessionInfo, SessionStudent } from '../../../api/sessions.types';

async function request<T = any>(path: string, init?: RequestInit) {
  return requestJson<T>(path, init);
}

function sortStudentsByName(students: SessionStudent[]): SessionStudent[] {
  return students.slice().sort((a, b) => {
    const nameA = `${(a.apellido ?? '').trim()} ${(a.nombre ?? '').trim()}`.trim().toLowerCase();
    const nameB = `${(b.apellido ?? '').trim()} ${(b.nombre ?? '').trim()}`.trim().toLowerCase();
    if (nameA && nameB) {
      const compare = nameA.localeCompare(nameB, 'es');
      if (compare !== 0) {
        return compare;
      }
    }
    if (nameA) return -1;
    if (nameB) return 1;
    const dniA = (a.dni ?? '').trim().toUpperCase();
    const dniB = (b.dni ?? '').trim().toUpperCase();
    if (dniA && dniB) {
      const compare = dniA.localeCompare(dniB, 'es');
      if (compare !== 0) {
        return compare;
      }
    }
    if (dniA) return -1;
    if (dniB) return 1;
    return (a.id ?? '').localeCompare(b.id ?? '', 'es');
  });
}

async function fetchStudentsRequest(params: {
  dealId: string;
  sessionId?: string | null;
  sort?: boolean;
}): Promise<SessionStudent[]> {
  const normalizedDealId = String(params.dealId ?? '').trim();
  const normalizedSessionId = String(params.sessionId ?? '').trim();

  if (!normalizedDealId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId es obligatorio');
  }
  if (params.sessionId !== undefined && !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'sessionId es obligatorio');
  }

  const searchParams = new URLSearchParams({ deal_id: normalizedDealId });
  if (normalizedSessionId) {
    searchParams.set('sesion_id', normalizedSessionId);
  }

  const data = await request<{ students?: unknown[] }>(`/alumnos?${searchParams.toString()}`);
  const rows: any[] = Array.isArray(data?.students) ? data.students : [];
  const students = rows.map((row) => normalizeSessionStudent(row));

  return params.sort ? sortStudentsByName(students) : students;
}

export async function fetchSessionStudents(
  dealId: string,
  sessionId: string,
): Promise<SessionStudent[]> {
  return fetchStudentsRequest({ dealId, sessionId });
}

export async function fetchDealStudents(dealId: string): Promise<SessionStudent[]> {
  return fetchStudentsRequest({ dealId, sort: true });
}

export type CreateSessionStudentInput = {
  dealId: string;
  sessionId: string;
  nombre: string;
  apellido: string;
  dni: string;
  asistencia?: boolean;
  apto?: boolean;
  certificado?: boolean;
};

export async function createSessionStudent(input: CreateSessionStudentInput): Promise<SessionStudent> {
  const normalizedDealId = String(input.dealId ?? '').trim();
  const normalizedSessionId = String(input.sessionId ?? '').trim();
  const nombre = String(input.nombre ?? '').trim();
  const apellido = String(input.apellido ?? '').trim();
  const dni = String(input.dni ?? '').trim();
  const asistencia = Boolean(input.asistencia);
  const apto = Boolean(input.apto);
  const certificado = Boolean(input.certificado);

  if (!normalizedDealId || !normalizedSessionId) {
    throw new ApiError('VALIDATION_ERROR', 'dealId y sessionId son obligatorios');
  }
  if (!nombre.length || !apellido.length || !dni.length) {
    throw new ApiError('VALIDATION_ERROR', 'Nombre, apellidos y DNI son obligatorios');
  }

  const data = await request<{ student?: unknown }>('/alumnos', {
    method: 'POST',
    body: JSON.stringify({
      deal_id: normalizedDealId,
      sesion_id: normalizedSessionId,
      nombre,
      apellido,
      dni,
      asistencia,
      apto,
      certificado,
    }),
  });

  return normalizeSessionStudent(data?.student ?? {});
}

export type UpdateSessionStudentInput = {
  nombre?: string;
  apellido?: string;
  dni?: string;
  asistencia?: boolean;
  apto?: boolean;
  certificado?: boolean;
  drive_url?: string | null;
  driveUrl?: string | null;
};

export async function updateSessionStudent(
  studentId: string,
  input: UpdateSessionStudentInput,
): Promise<SessionStudent> {
  const normalizedId = String(studentId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'studentId es obligatorio');
  }

  const payload: Record<string, unknown> = {};
  if (input.nombre !== undefined) payload.nombre = String(input.nombre ?? '').trim();
  if (input.apellido !== undefined) payload.apellido = String(input.apellido ?? '').trim();
  if (input.dni !== undefined) payload.dni = String(input.dni ?? '').trim();
  if (input.asistencia !== undefined) payload.asistencia = Boolean(input.asistencia);
  if (input.apto !== undefined) payload.apto = Boolean(input.apto);
  if (input.certificado !== undefined) payload.certificado = Boolean(input.certificado);
  if (input.drive_url !== undefined || input.driveUrl !== undefined) {
    const driveUrlValue = input.drive_url !== undefined ? input.drive_url : input.driveUrl;
    payload.drive_url = normalizeDriveUrlInput(driveUrlValue ?? null);
  }

  const data = await request<{ student?: unknown }>(`/alumnos/${encodeURIComponent(normalizedId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  return normalizeSessionStudent(data?.student ?? {});
}

export async function deleteSessionStudent(studentId: string): Promise<void> {
  const normalizedId = String(studentId ?? '').trim();
  if (!normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'studentId es obligatorio');
  }

  await request(`/alumnos/${encodeURIComponent(normalizedId)}`, { method: 'DELETE' });
}

export async function fetchPublicSessionStudents(token: string): Promise<{
  session: PublicSessionInfo;
  students: SessionStudent[];
}> {
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedToken) {
    throw new ApiError('VALIDATION_ERROR', 'token es obligatorio');
  }

  const params = new URLSearchParams({ token: normalizedToken });
  const data = await request<{ session?: unknown; students?: unknown[] }>(
    `/public-session-students?${params.toString()}`,
  );
  const sessionInfo = normalizePublicSessionInfo(data?.session ?? {});
  const students: any[] = Array.isArray(data?.students) ? data.students : [];
  return {
    session: sessionInfo,
    students: students.map((row) => normalizeSessionStudent(row)),
  };
}

export type PublicStudentInput = {
  token: string;
  nombre: string;
  apellido: string;
  dni: string;
};

export async function createPublicSessionStudent(input: PublicStudentInput): Promise<SessionStudent> {
  const token = String(input.token ?? '').trim();
  if (!token) {
    throw new ApiError('VALIDATION_ERROR', 'token es obligatorio');
  }
  const nombre = String(input.nombre ?? '').trim();
  const apellido = String(input.apellido ?? '').trim();
  const dni = String(input.dni ?? '').trim();
  if (!nombre.length || !apellido.length || !dni.length) {
    throw new ApiError('VALIDATION_ERROR', 'Nombre, apellidos y DNI son obligatorios');
  }

  const data = await request<{ student?: unknown }>('/public-session-students', {
    method: 'POST',
    body: JSON.stringify({ token, nombre, apellido, dni }),
  });

  return normalizeSessionStudent(data?.student ?? {});
}

export async function updatePublicSessionStudent(
  token: string,
  studentId: string,
  input: { nombre?: string; apellido?: string; dni?: string },
): Promise<SessionStudent> {
  const normalizedToken = String(token ?? '').trim();
  const normalizedId = String(studentId ?? '').trim();
  if (!normalizedToken || !normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'token y studentId son obligatorios');
  }

  const payload: Record<string, unknown> = {};
  if (input.nombre !== undefined) payload.nombre = String(input.nombre ?? '').trim();
  if (input.apellido !== undefined) payload.apellido = String(input.apellido ?? '').trim();
  if (input.dni !== undefined) payload.dni = String(input.dni ?? '').trim();

  const params = new URLSearchParams({ token: normalizedToken });
  const data = await request<{ student?: unknown }>(
    `/public-session-students/${encodeURIComponent(normalizedId)}?${params.toString()}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );

  return normalizeSessionStudent(data?.student ?? {});
}

export async function deletePublicSessionStudent(token: string, studentId: string): Promise<void> {
  const normalizedToken = String(token ?? '').trim();
  const normalizedId = String(studentId ?? '').trim();
  if (!normalizedToken || !normalizedId) {
    throw new ApiError('VALIDATION_ERROR', 'token y studentId son obligatorios');
  }

  const params = new URLSearchParams({ token: normalizedToken });
  await request(`/public-session-students/${encodeURIComponent(normalizedId)}?${params.toString()}`, {
    method: 'DELETE',
  });
}
