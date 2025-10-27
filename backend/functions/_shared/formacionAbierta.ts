import type { Prisma } from '@prisma/client';
import { nowInMadridDate } from './timezone';
import { studentsFromNotes, type StudentIdentifier } from './studentsFromNotes';

function normalizePipelineLabelValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  return str.length ? str : null;
}

function normalizeLabelForComparison(value: unknown): string | null {
  const label = normalizePipelineLabelValue(value);
  if (!label) return null;
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isFormacionAbiertaPipeline(value: unknown): boolean {
  const normalized = normalizeLabelForComparison(value);
  if (!normalized) return false;
  return normalized === 'formacion abierta';
}

export type SessionForStudents = {
  id: string;
  estado: string | null;
  fecha_inicio_utc: Date | string | null;
  created_at: Date | string | null;
  nombre_cache: string | null;
};

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function pickDefaultSessionIdForStudents(
  sessions: readonly SessionForStudents[],
): string | null {
  const filtered = sessions
    .map((session) => {
      const id = typeof session?.id === 'string' ? session.id.trim() : '';
      if (!id.length) return null;
      return { ...session, id } as SessionForStudents & { id: string };
    })
    .filter((session): session is SessionForStudents & { id: string } => Boolean(session));

  if (!filtered.length) {
    return null;
  }

  const preferred = filtered.filter((session) => session.estado !== 'CANCELADA');
  const candidates = preferred.length ? preferred : filtered;

  const sorted = candidates.slice().sort((a, b) => {
    const startA = toTimestamp(a.fecha_inicio_utc);
    const startB = toTimestamp(b.fecha_inicio_utc);
    if (startA !== null && startB !== null && startA !== startB) {
      return startA - startB;
    }
    if (startA !== null && startB === null) return -1;
    if (startA === null && startB !== null) return 1;

    const createdA = toTimestamp(a.created_at) ?? 0;
    const createdB = toTimestamp(b.created_at) ?? 0;
    if (createdA !== createdB) return createdA - createdB;

    const nameA = (a.nombre_cache ?? '').trim().toLowerCase();
    const nameB = (b.nombre_cache ?? '').trim().toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB, 'es');

    return a.id.localeCompare(b.id, 'es');
  });

  return sorted[0]?.id ?? null;
}

export function buildStudentIdentifierKey(
  sessionId: string | null | undefined,
  identifier: StudentIdentifier | null,
): string | null {
  if (!identifier) return null;
  if (!sessionId) return null;
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId.length) return null;
  return `${trimmedSessionId}::${identifier.type}::${identifier.value}`;
}

export type FormacionAbiertaStudentsSyncResult = {
  studentsCreated: number;
  studentsSkippedDuplicate: number;
  studentsSkippedMissingIdentifier: number;
  studentsSkippedNoSession: number;
  primaryNoteId: string | null;
};

export async function syncFormacionAbiertaStudentsFromNotes(
  tx: Prisma.TransactionClient,
  dealId: string,
): Promise<FormacionAbiertaStudentsSyncResult> {
  const sessions = await tx.sessions.findMany({
    where: { deal_id: dealId },
    orderBy: [
      { fecha_inicio_utc: 'asc' },
      { created_at: 'asc' },
      { id: 'asc' },
    ],
    select: {
      id: true,
      estado: true,
      fecha_inicio_utc: true,
      created_at: true,
      nombre_cache: true,
    },
  });

  const notes = await tx.deal_notes.findMany({
    where: { deal_id: dealId },
    orderBy: [{ created_at: 'desc' }],
    select: { id: true, content: true },
  });

  const parsedStudents = studentsFromNotes(notes);
  const primaryNoteId = parsedStudents[0]?.sourceNoteId ?? null;
  const defaultSessionId = pickDefaultSessionIdForStudents(sessions);

  if (!defaultSessionId) {
    if (parsedStudents.length) {
      console.warn(
        '[formacion-abierta-import] No hay sesiones disponibles para crear alumnos',
        { dealId, noteId: primaryNoteId },
      );
    }

    return {
      studentsCreated: 0,
      studentsSkippedDuplicate: 0,
      studentsSkippedMissingIdentifier: 0,
      studentsSkippedNoSession: parsedStudents.length,
      primaryNoteId,
    };
  }

  if (!parsedStudents.length) {
    return {
      studentsCreated: 0,
      studentsSkippedDuplicate: 0,
      studentsSkippedMissingIdentifier: 0,
      studentsSkippedNoSession: 0,
      primaryNoteId,
    };
  }

  const timestamp = nowInMadridDate();

  const existingStudents = await tx.alumnos.findMany({
    where: { deal_id: dealId },
    select: { sesion_id: true, dni: true },
  });

  const existingKeys = new Set<string>();
  for (const existing of existingStudents) {
    const key = existing.dni
      ? buildStudentIdentifierKey(existing.sesion_id, {
          type: 'DNI',
          value: existing.dni,
        })
      : null;
    if (key) existingKeys.add(key);
  }

  let studentsCreated = 0;
  let studentsSkippedDuplicate = 0;
  let studentsSkippedMissingIdentifier = 0;

  for (const student of parsedStudents) {
    const dniKey = student.dni
      ? buildStudentIdentifierKey(defaultSessionId, { type: 'DNI', value: student.dni })
      : null;
    const identifierKey = buildStudentIdentifierKey(defaultSessionId, student.identifier);
    const keysToCheck = [identifierKey, dniKey].filter((key): key is string => Boolean(key));

    if (keysToCheck.some((key) => existingKeys.has(key))) {
      studentsSkippedDuplicate += 1;
      continue;
    }

    const dni = typeof student.dni === 'string' ? student.dni.trim() : '';
    if (!dni.length) {
      if (identifierKey) existingKeys.add(identifierKey);
      studentsSkippedMissingIdentifier += 1;
      continue;
    }

    const nombre = typeof student.nombre === 'string' ? student.nombre.trim() : '';
    const apellido = typeof student.apellido === 'string' ? student.apellido.trim() : '';
    if (!nombre.length || !apellido.length) {
      if (identifierKey) existingKeys.add(identifierKey);
      if (dniKey) existingKeys.add(dniKey);
      studentsSkippedMissingIdentifier += 1;
      continue;
    }

    await tx.alumnos.create({
      data: {
        deal_id: dealId,
        sesion_id: defaultSessionId,
        nombre,
        apellido,
        dni,
        apto: false,
        certificado: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });

    keysToCheck.forEach((key) => existingKeys.add(key));
    studentsCreated += 1;
  }

  return {
    studentsCreated,
    studentsSkippedDuplicate,
    studentsSkippedMissingIdentifier,
    studentsSkippedNoSession: 0,
    primaryNoteId,
  };
}
