export type NoteRecord = { id?: unknown; content?: unknown };

export type StudentIdentifier =
  | { type: 'EMAIL'; value: string }
  | { type: 'DNI'; value: string }
  | { type: 'NAME_PHONE'; value: string };

export type ParsedNoteStudent = {
  sourceNoteId: string | null;
  nombre: string;
  apellido: string;
  dni: string | null;
  email: string | null;
  telefono: string | null;
  identifier: StudentIdentifier | null;
};

function normalizeWhitespace(value: string): string {
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

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.length || !/@/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  if (/^[^0-9+]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/[^0-9+]/g, '');
  const normalized = digits.startsWith('+') ? `+${digits.slice(1).replace(/[^0-9]/g, '')}` : digits;
  const digitCount = normalized.replace(/[^0-9]/g, '').length;
  if (digitCount < 7) return null;
  return normalized;
}

function normalizeDni(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized.length) return null;
  if (normalized.length < 5) return null;
  return normalized;
}

function resolveIdentifier(
  student: Omit<ParsedNoteStudent, 'identifier' | 'sourceNoteId'>,
): StudentIdentifier | null {
  if (student.email) {
    return { type: 'EMAIL', value: student.email };
  }
  if (student.dni) {
    return { type: 'DNI', value: student.dni };
  }
  if (student.telefono) {
    const key = `${normalizeWhitespace(`${student.nombre} ${student.apellido}`.trim()).toLowerCase()}|${student.telefono}`;
    if (key.trim().length) {
      return { type: 'NAME_PHONE', value: key };
    }
  }
  return null;
}

function parseEntry(entry: string) {
  const rawParts = entry
    .split('|')
    .map((part) => normalizeWhitespace(part.replace(/^["']+/, '').replace(/["']+$/, '')))
    .filter((part) => part.length > 0);

  // Formato esperado: Nombre | Apellido [| Email] | DNI
  // El último campo siempre es el DNI (posicional, igual que el parser del frontend).
  // Usar detección dinámica de teléfono causaba que DNIs españoles (8 dígitos + letra)
  // se clasificaran como teléfonos, dejando solo 1 parte y devolviendo null.
  if (rawParts.length < 3) {
    return null;
  }

  const nombre = rawParts[0];
  const lastPart = rawParts[rawParts.length - 1];
  const dni = normalizeDni(lastPart);

  if (!nombre.length || !dni) {
    return null;
  }

  const middleParts = rawParts.slice(1, -1);

  // Si algún campo intermedio contiene '@', es el email; el resto es el apellido.
  let email: string | null = null;
  const apellidoParts: string[] = [];
  for (const part of middleParts) {
    const normalizedEmail = normalizeEmail(part);
    if (normalizedEmail && !email) {
      email = normalizedEmail;
    } else {
      apellidoParts.push(part);
    }
  }

  const apellido = normalizeWhitespace(apellidoParts.join(' '));
  if (!apellido.length) {
    return null;
  }

  return { nombre, apellido, dni, email, telefono: null };
}

export function studentsFromNotes(notes: readonly NoteRecord[] | null | undefined): ParsedNoteStudent[] {
  if (!Array.isArray(notes) || notes.length === 0) {
    return [];
  }

  for (const note of notes) {
    const content = typeof note?.content === 'string' ? note.content : '';
    if (!content.trim().length) {
      continue;
    }

    const sanitized = sanitizeNoteContent(content);
    const headerIndex = sanitized.toLowerCase().indexOf('alumnos del deal');
    if (headerIndex === -1) {
      continue;
    }

    const afterHeader = sanitized
      .slice(headerIndex + 'alumnos del deal'.length)
      .replace(/^[:\-\s"']+/, '');

    if (!afterHeader.trim().length) {
      continue;
    }

    const normalizedBody = afterHeader
      .replace(/\n+/g, ' ')
      .replace(/\s*;\s*/g, ';')
      .replace(/\s*\|\s*/g, '|')
      .trim();

    if (!normalizedBody.length) {
      continue;
    }

    const noteId =
      typeof note?.id === 'string' && note.id.trim().length ? note.id.trim() : null;

    const seen = new Set<string>();
    const results: ParsedNoteStudent[] = [];

    normalizedBody
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .forEach((entry) => {
        const parsed = parseEntry(entry);
        if (!parsed) {
          return;
        }

        const identifier = resolveIdentifier(parsed);
        const key = identifier ? `${identifier.type}|${identifier.value}` : null;
        if (key && seen.has(key)) {
          return;
        }
        if (key) {
          seen.add(key);
        }

        results.push({
          sourceNoteId: noteId,
          nombre: parsed.nombre,
          apellido: parsed.apellido,
          dni: parsed.dni,
          email: parsed.email,
          telefono: parsed.telefono,
          identifier,
        });
      });

    if (results.length) {
      return results;
    }
  }

  return [];
}
