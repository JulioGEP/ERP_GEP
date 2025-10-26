// backend/functions/_shared/noteStudents.ts
// Utilidades para sincronizar alumnos desde notas de Pipedrive al importar deals

import type { PrismaClient } from "@prisma/client";

type Nullable<T> = T | null | undefined;

export type NoteStudentEntry = {
  nombre: string;
  apellido: string;
  dni: string;
};

type DealNoteLike = {
  id?: Nullable<string | number>;
  content?: Nullable<string>;
  note?: Nullable<string>;
};

type SessionSummary = {
  id: Nullable<string>;
  estado?: Nullable<string>;
  fecha_inicio_utc?: Nullable<string | Date>;
  nombre_cache?: Nullable<string>;
};

type ExistingStudent = {
  id: string;
  sesion_id: Nullable<string>;
  nombre: Nullable<string>;
  apellido: Nullable<string>;
  dni: Nullable<string>;
};

const NOTE_HEADER = "alumnos del deal";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeNoteContent(content: string): string {
  return content
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[“”]/g, "\"")
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .trim();
}

function parseNoteStudents(content: string): NoteStudentEntry[] {
  if (!content.trim().length) return [];

  const cleaned = sanitizeNoteContent(content);
  const headerIndex = cleaned.toLowerCase().indexOf(NOTE_HEADER);
  if (headerIndex === -1) {
    return [];
  }

  const afterHeader = cleaned.slice(headerIndex + NOTE_HEADER.length).replace(/^[:\-\s"']+/, "");
  if (!afterHeader.trim().length) {
    return [];
  }

  const normalizedBody = afterHeader
    .replace(/\n+/g, " ")
    .replace(/\s*;\s*/g, ";")
    .replace(/\s*\|\s*/g, "|")
    .trim();

  if (!normalizedBody.length) {
    return [];
  }

  const seen = new Set<string>();
  const result: NoteStudentEntry[] = [];

  normalizedBody
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => {
      const rawParts = entry
        .split("|")
        .map((part) => normalizeWhitespace(part.replace(/^["']+/, "").replace(/["']+$/, "")));

      const parts = rawParts.filter((part) => part.length > 0);
      if (parts.length < 3) {
        return;
      }

      const nombre = parts[0];
      const apellido = parts.slice(1, -1).join(" ").trim();
      const dni = parts[parts.length - 1].toUpperCase().replace(/[^A-Z0-9]/g, "");

      if (!nombre.length || !apellido.length || !dni.length) {
        return;
      }

      if (seen.has(dni)) {
        return;
      }

      seen.add(dni);
      result.push({ nombre, apellido, dni });
    });

  return result;
}

export function extractNoteStudentsFromNotes(notes: readonly DealNoteLike[] | null | undefined): {
  noteId: string | null;
  students: NoteStudentEntry[];
} {
  if (!Array.isArray(notes)) {
    return { noteId: null, students: [] };
  }

  for (const note of notes) {
    const rawContent = typeof note?.content === "string" ? note.content : typeof note?.note === "string" ? note.note : "";
    if (!rawContent.trim().length) {
      continue;
    }

    const students = parseNoteStudents(rawContent);
    if (!students.length) {
      continue;
    }

    const rawId = note?.id;
    const noteId =
      typeof rawId === "string"
        ? rawId.trim()
        : rawId !== null && rawId !== undefined
        ? String(rawId).trim()
        : "";

    return { noteId: noteId.length ? noteId : null, students };
  }

  return { noteId: null, students: [] };
}

function normalizePipelineKey(value: Nullable<string>): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toTimestamp(value: Nullable<string | Date>): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = new Date(trimmed);
    const time = parsed.getTime();
    if (!Number.isNaN(time)) return time;

    const fallback = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (fallback) {
      const [, day, month, year] = fallback;
      const isoCandidate = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`;
      const fallbackDate = new Date(isoCandidate);
      const fallbackTime = fallbackDate.getTime();
      return Number.isNaN(fallbackTime) ? null : fallbackTime;
    }
  }
  return null;
}

export function pickDefaultSessionId(sessions: readonly SessionSummary[]): string | null {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  const normalized = sessions
    .map((session) => {
      const idRaw = session?.id;
      const id = typeof idRaw === "string" ? idRaw.trim() : idRaw != null ? String(idRaw).trim() : "";
      if (!id.length) {
        return null;
      }
      return {
        id,
        estado: typeof session?.estado === "string" ? session.estado.trim().toUpperCase() : null,
        fecha: toTimestamp(session?.fecha_inicio_utc ?? null),
        nombre: typeof session?.nombre_cache === "string" ? session.nombre_cache.trim().toLowerCase() : "",
      };
    })
    .filter((session): session is { id: string; estado: string | null; fecha: number | null; nombre: string } => session !== null);

  if (!normalized.length) {
    return null;
  }

  const preferred = normalized.filter((session) => session.estado !== "CANCELADA");
  const candidates = preferred.length ? preferred : normalized;

  const sorted = candidates.slice().sort((a, b) => {
    if (a.fecha !== null && b.fecha !== null) {
      const compare = a.fecha - b.fecha;
      if (compare !== 0) return compare;
    } else if (a.fecha !== null) {
      return -1;
    } else if (b.fecha !== null) {
      return 1;
    }

    if (a.nombre && b.nombre) {
      const compare = a.nombre.localeCompare(b.nombre, "es");
      if (compare !== 0) return compare;
    } else if (a.nombre) {
      return -1;
    } else if (b.nombre) {
      return 1;
    }

    return a.id.localeCompare(b.id, "es");
  });

  return sorted[0]?.id ?? null;
}

function normalizeNameForCompare(value: Nullable<string>): string {
  if (typeof value !== "string") return "";
  return normalizeWhitespace(value).toUpperCase();
}

function normalizeDni(value: Nullable<string>): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

export function diffNoteStudents(
  noteStudents: readonly NoteStudentEntry[],
  existingStudents: readonly ExistingStudent[],
): {
  toCreate: NoteStudentEntry[];
  toUpdate: { id: string; nombre: string; apellido: string }[];
} {
  const existingByDni = new Map<string, ExistingStudent>();

  existingStudents.forEach((student) => {
    const dni = normalizeDni(student.dni);
    if (!dni.length || existingByDni.has(dni)) return;
    existingByDni.set(dni, student);
  });

  const toCreate: NoteStudentEntry[] = [];
  const toUpdate: { id: string; nombre: string; apellido: string }[] = [];

  noteStudents.forEach((student) => {
    const dni = normalizeDni(student.dni);
    if (!dni.length) {
      return;
    }

    const match = existingByDni.get(dni);
    if (!match) {
      toCreate.push(student);
      return;
    }

    const normalizedNombre = normalizeNameForCompare(student.nombre);
    const normalizedApellido = normalizeNameForCompare(student.apellido);
    const currentNombre = normalizeNameForCompare(match.nombre);
    const currentApellido = normalizeNameForCompare(match.apellido);

    if (normalizedNombre !== currentNombre || normalizedApellido !== currentApellido) {
      toUpdate.push({ id: match.id, nombre: student.nombre, apellido: student.apellido });
    }
  });

  return { toCreate, toUpdate };
}

export async function syncNoteStudentsFromNotes(options: {
  prisma: PrismaClient;
  dealId: string;
  pipelineLabel: Nullable<string>;
  notes: readonly DealNoteLike[] | null | undefined;
}): Promise<string[]> {
  const warnings: string[] = [];

  const pipelineKey = normalizePipelineKey(options.pipelineLabel ?? null);
  if (!pipelineKey.includes("formacion abierta")) {
    return warnings;
  }

  const { students } = extractNoteStudentsFromNotes(options.notes);
  if (!students.length) {
    return warnings;
  }

  const sessions = await options.prisma.sessions.findMany({
    where: { deal_id: options.dealId },
    select: { id: true, estado: true, fecha_inicio_utc: true, nombre_cache: true },
  });

  if (!sessions.length) {
    warnings.push("No se encontraron sesiones para asignar los alumnos sincronizados.");
    return warnings;
  }

  const defaultSessionId = pickDefaultSessionId(sessions);
  if (!defaultSessionId) {
    warnings.push("No se pudo determinar la sesión por defecto para los alumnos sincronizados.");
    return warnings;
  }

  const existingStudents = await options.prisma.alumnos.findMany({
    where: { deal_id: options.dealId },
    select: { id: true, sesion_id: true, nombre: true, apellido: true, dni: true },
  });

  const { toCreate, toUpdate } = diffNoteStudents(students, existingStudents);

  if (!toCreate.length && !toUpdate.length) {
    return warnings;
  }

  for (const update of toUpdate) {
    try {
      await options.prisma.alumnos.update({
        where: { id: update.id },
        data: { nombre: update.nombre, apellido: update.apellido },
      });
    } catch (error) {
      warnings.push(
        `No se pudo actualizar el alumno con DNI sincronizado (${update.apellido.toUpperCase()} ${update.nombre}).`,
      );
    }
  }

  for (const student of toCreate) {
    try {
      await options.prisma.alumnos.create({
        data: {
          deal_id: options.dealId,
          sesion_id: defaultSessionId,
          nombre: student.nombre,
          apellido: student.apellido,
          dni: student.dni,
        },
      });
    } catch (error) {
      warnings.push(`No se pudo crear el alumno ${student.nombre} ${student.apellido} (${student.dni}).`);
    }
  }

  return warnings;
}

