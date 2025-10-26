import type { DealDetail } from '../../../types/deal';
import type { SessionDTO, SessionStudent } from '../api';

export type NoteStudentEntry = { nombre: string; apellido: string; dni: string };

const NOTE_HEADER = 'alumnos del deal';

export function normalizeNoteWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeNoteContent(content: string): string {
  return content
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/^["']+/, '')
    .replace(/["']+$/, '')
    .trim();
}

function parseNoteStudents(content: string): NoteStudentEntry[] {
  if (!content.trim().length) return [];

  const cleaned = sanitizeNoteContent(content);
  const headerIndex = cleaned.toLowerCase().indexOf(NOTE_HEADER);
  if (headerIndex === -1) {
    return [];
  }

  const afterHeader = cleaned.slice(headerIndex + NOTE_HEADER.length).replace(/^[:\-\s"']+/, '');
  if (!afterHeader.trim().length) {
    return [];
  }

  const normalizedBody = afterHeader
    .replace(/\n+/g, ' ')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*\|\s*/g, '|')
    .trim();

  if (!normalizedBody.length) {
    return [];
  }

  const seen = new Set<string>();
  const result: NoteStudentEntry[] = [];

  normalizedBody
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => {
      const rawParts = entry
        .split('|')
        .map((part) => normalizeNoteWhitespace(part.replace(/^["']+/, '').replace(/["']+$/, '')));

      const parts = rawParts.filter((part) => part.length > 0);
      if (parts.length < 3) {
        return;
      }

      const nombre = parts[0];
      const apellido = parts.slice(1, -1).join(' ').trim();
      const dni = parts[parts.length - 1].toUpperCase().replace(/[^A-Z0-9]/g, '');

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

export function buildNoteStudentsSignature(
  noteId: string | null,
  students: readonly NoteStudentEntry[],
): string {
  const sorted = students
    .map((student) => ({
      nombre: normalizeNoteWhitespace(student.nombre),
      apellido: normalizeNoteWhitespace(student.apellido),
      dni: student.dni.trim().toUpperCase(),
    }))
    .sort((a, b) => {
      const dniCompare = a.dni.localeCompare(b.dni, 'es');
      if (dniCompare !== 0) return dniCompare;
      const lastCompare = a.apellido.localeCompare(b.apellido, 'es');
      if (lastCompare !== 0) return lastCompare;
      return a.nombre.localeCompare(b.nombre, 'es');
    });

  const serialized = sorted
    .map((student) => `${student.dni}|${student.nombre}|${student.apellido}`)
    .join(';');

  return `${noteId ?? 'unknown'}|${serialized}`;
}

export function extractNoteStudents(
  notes: DealDetail['notes'] | undefined | null,
): { noteId: string | null; signature: string | null; students: NoteStudentEntry[] } {
  if (!Array.isArray(notes)) {
    return { noteId: null, signature: null, students: [] };
  }

  for (const note of notes) {
    const content = typeof note?.content === 'string' ? note.content : '';
    if (!content.trim().length) {
      continue;
    }
    const students = parseNoteStudents(content);
    if (!students.length) {
      continue;
    }
    const noteId = typeof note?.id === 'string' && note.id.trim().length ? note.id.trim() : null;
    return {
      noteId,
      signature: buildNoteStudentsSignature(noteId, students),
      students,
    };
  }

  return { noteId: null, signature: null, students: [] };
}

export function pickDefaultSessionId(sessions: readonly SessionDTO[] | null | undefined): string | null {
  if (!sessions || sessions.length === 0) {
    return null;
  }

  const filtered = sessions.filter(
    (session): session is SessionDTO => Boolean(session && typeof session.id === 'string' && session.id.trim().length),
  );

  if (!filtered.length) {
    return null;
  }

  const preferred = filtered.filter((session) => session.estado !== 'CANCELADA');
  const candidates = preferred.length ? preferred : filtered;

  const sorted = candidates.slice().sort((a, b) => {
    const startA = (a.fecha_inicio_utc ?? '').trim();
    const startB = (b.fecha_inicio_utc ?? '').trim();
    if (startA && startB) {
      const compare = startA.localeCompare(startB);
      if (compare !== 0) {
        return compare;
      }
    } else if (startA) {
      return -1;
    } else if (startB) {
      return 1;
    }

    const nameA = (a.nombre_cache ?? '').trim().toLowerCase();
    const nameB = (b.nombre_cache ?? '').trim().toLowerCase();
    const nameCompare = nameA.localeCompare(nameB, 'es');
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.id.localeCompare(b.id, 'es');
  });

  return sorted[0]?.id ?? null;
}

export function diffNoteStudents(
  noteStudents: readonly NoteStudentEntry[],
  existingStudents: readonly SessionStudent[],
): {
  toCreate: NoteStudentEntry[];
  toUpdate: { id: string; nombre: string; apellido: string }[];
} {
  const normalizeName = (value: string) => normalizeNoteWhitespace(value).toUpperCase();

  const existingByDni = new Map<string, SessionStudent>();

  existingStudents.forEach((student) => {
    const dni = (student.dni ?? '').trim().toUpperCase();
    if (!dni.length || existingByDni.has(dni)) return;
    existingByDni.set(dni, student);
  });

  const toCreate: NoteStudentEntry[] = [];
  const toUpdate: { id: string; nombre: string; apellido: string }[] = [];

  noteStudents.forEach((student) => {
    const dni = student.dni.trim().toUpperCase();
    if (!dni.length) return;
    const existing = existingByDni.get(dni);
    if (!existing) {
      toCreate.push(student);
      return;
    }

    const existingNombre = normalizeName(existing.nombre ?? '');
    const existingApellido = normalizeName(existing.apellido ?? '');
    const incomingNombre = normalizeName(student.nombre);
    const incomingApellido = normalizeName(student.apellido);

    if (existingNombre !== incomingNombre || existingApellido !== incomingApellido) {
      if (existing.id) {
        toUpdate.push({ id: existing.id, nombre: student.nombre, apellido: student.apellido });
      }
    }
  });

  return { toCreate, toUpdate };
}
