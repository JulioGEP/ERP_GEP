import { getPrisma } from './prisma';

export type NoteStudentEntry = {
  nombre: string;
  apellido: string;
  dni: string;
};

export type NoteStudentsSyncResult = {
  processed: boolean;
  created: number;
  updated: number;
  sessionId: string | null;
  noteId: string | null;
  warning?: string;
};

const OPEN_TRAINING_PIPELINE_KEY = 'formacion abierta';

function normalizePipelineValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isOpenTrainingPipeline(pipelineLabel: string | null | undefined): boolean {
  return normalizePipelineValue(pipelineLabel) === OPEN_TRAINING_PIPELINE_KEY;
}

function normalizeNoteWhitespace(value: string): string {
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
  const headerIndex = cleaned.toLowerCase().indexOf('alumnos del deal');
  if (headerIndex === -1) {
    return [];
  }

  const afterHeader = cleaned.slice(headerIndex + 'alumnos del deal'.length).replace(/^[:\-\s"']+/, '');
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

function extractNoteStudents(
  notes: any[] | null | undefined,
): { noteId: string | null; students: NoteStudentEntry[] } {
  if (!Array.isArray(notes)) {
    return { noteId: null, students: [] };
  }

  for (const note of notes) {
    if (!note) continue;
    const rawContent =
      (typeof note.content === 'string' && note.content.trim().length ? note.content : null) ??
      (typeof note.note === 'string' && note.note.trim().length ? note.note : null) ??
      '';
    if (!rawContent.trim().length) {
      continue;
    }

    const students = parseNoteStudents(rawContent);
    if (!students.length) {
      continue;
    }

    const noteId = typeof note.id === 'string' && note.id.trim().length ? note.id.trim() : null;
    return { noteId, students };
  }

  return { noteId: null, students: [] };
}

function normalizeDni(value: string): string | null {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!trimmed.length) return null;
  if (trimmed.length < 7 || trimmed.length > 12) return null;
  if (!/^[A-Z0-9]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeName(value: string): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length ? trimmed : null;
}

function normalizeForComparison(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

type SessionRecord = {
  id: string;
  estado: string | null;
  fecha_inicio_utc: Date | null;
  nombre_cache: string | null;
};

function pickDefaultSessionId(sessions: SessionRecord[]): string | null {
  if (!sessions.length) {
    return null;
  }

  const filtered = sessions
    .map((session) => ({
      id: typeof session.id === 'string' ? session.id.trim() : '',
      estado: session.estado ?? null,
      fecha_inicio_utc: session.fecha_inicio_utc ?? null,
      nombre_cache: typeof session.nombre_cache === 'string' ? session.nombre_cache : null,
    }))
    .filter((session) => session.id.length > 0);

  if (!filtered.length) {
    return null;
  }

  const preferred = filtered.filter((session) => session.estado !== 'CANCELADA');
  const candidates = preferred.length ? preferred : filtered;

  const sorted = candidates.slice().sort((a, b) => {
    const timeA = a.fecha_inicio_utc instanceof Date ? a.fecha_inicio_utc.getTime() : null;
    const timeB = b.fecha_inicio_utc instanceof Date ? b.fecha_inicio_utc.getTime() : null;

    if (timeA !== null && timeB !== null) {
      if (timeA !== timeB) {
        return timeA - timeB;
      }
    } else if (timeA !== null) {
      return -1;
    } else if (timeB !== null) {
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

export async function syncStudentsFromDealNotes(params: {
  dealId: string;
  pipelineLabel: string | null | undefined;
  notes: any[] | null | undefined;
}): Promise<NoteStudentsSyncResult> {
  const { dealId, pipelineLabel, notes } = params;
  const normalizedDealId = typeof dealId === 'string' ? dealId.trim() : String(dealId ?? '');
  if (!normalizedDealId) {
    return { processed: false, created: 0, updated: 0, sessionId: null, noteId: null };
  }

  if (!isOpenTrainingPipeline(pipelineLabel)) {
    return { processed: false, created: 0, updated: 0, sessionId: null, noteId: null };
  }

  const { noteId, students } = extractNoteStudents(notes ?? []);
  if (!students.length) {
    return { processed: false, created: 0, updated: 0, sessionId: null, noteId };
  }

  const prisma = getPrisma();

  const sessionRows = await prisma.sessions.findMany({
    where: { deal_id: normalizedDealId },
    select: { id: true, estado: true, fecha_inicio_utc: true, nombre_cache: true },
  });

  const sessionRecords: SessionRecord[] = sessionRows.map((session) => ({
    id: typeof session.id === 'string' ? session.id : String(session.id ?? ''),
    estado: session.estado ? String(session.estado) : null,
    fecha_inicio_utc: session.fecha_inicio_utc ?? null,
    nombre_cache: typeof session.nombre_cache === 'string' ? session.nombre_cache : null,
  }));

  const sessionId = pickDefaultSessionId(sessionRecords);
  if (!sessionId) {
    return {
      processed: false,
      created: 0,
      updated: 0,
      sessionId: null,
      noteId,
      warning: 'No se encontró ninguna sesión para sincronizar los alumnos de las notas.',
    };
  }

  const { created, updated } = await prisma.$transaction(async (tx) => {
    const existing = await tx.alumnos.findMany({
      where: { deal_id: normalizedDealId, sesion_id: sessionId },
      select: { id: true, nombre: true, apellido: true, dni: true },
    });

    const existingByDni = new Map<string, typeof existing[number]>();
    for (const student of existing) {
      const dni = typeof student.dni === 'string' ? student.dni.trim().toUpperCase() : '';
      if (!dni.length) continue;
      if (!existingByDni.has(dni)) {
        existingByDni.set(dni, student);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const entry of students) {
      const normalizedDni = normalizeDni(entry.dni);
      if (!normalizedDni) {
        continue;
      }

      const normalizedNombre = normalizeName(entry.nombre);
      const normalizedApellido = normalizeName(entry.apellido);
      if (!normalizedNombre || !normalizedApellido) {
        continue;
      }

      const existingStudent = existingByDni.get(normalizedDni);
      if (!existingStudent) {
        const createdStudent = await tx.alumnos.create({
          data: {
            deal_id: normalizedDealId,
            sesion_id: sessionId,
            nombre: normalizedNombre,
            apellido: normalizedApellido,
            dni: normalizedDni,
          },
          select: { id: true, nombre: true, apellido: true, dni: true },
        });
        existingByDni.set(normalizedDni, createdStudent);
        createdCount += 1;
        continue;
      }

      const currentNombre = normalizeForComparison(existingStudent.nombre ?? '');
      const currentApellido = normalizeForComparison(existingStudent.apellido ?? '');
      const incomingNombre = normalizeForComparison(normalizedNombre);
      const incomingApellido = normalizeForComparison(normalizedApellido);

      if (currentNombre === incomingNombre && currentApellido === incomingApellido) {
        continue;
      }

      const updatedStudent = await tx.alumnos.update({
        where: { id: existingStudent.id },
        data: { nombre: normalizedNombre, apellido: normalizedApellido },
        select: { id: true, nombre: true, apellido: true, dni: true },
      });
      existingByDni.set(normalizedDni, updatedStudent);
      updatedCount += 1;
    }

    return { created: createdCount, updated: updatedCount };
  });

  return { processed: true, created, updated, sessionId, noteId };
}
