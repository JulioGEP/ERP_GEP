export type NoteRecord = { id?: unknown; content?: unknown };

export type StudentIdentifier =
  | { type: 'EMAIL'; value: string }
  | { type: 'DNI'; value: string }
  | { type: 'PHONE'; value: string };

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
  if (student.dni) {
    return { type: 'DNI', value: student.dni };
  }
  if (student.email) {
    return { type: 'EMAIL', value: student.email };
  }
  if (student.telefono) {
    return { type: 'PHONE', value: student.telefono };
  }
  return null;
}

function parseEntry(entry: string) {
  const rawParts = entry
    .split('|')
    .map((part) => normalizeWhitespace(part.replace(/^["']+/, '').replace(/["']+$/, '')))
    .filter((part) => part.length > 0);

  if (rawParts.length < 2) {
    return null;
  }

  const parts = [...rawParts];

  let email: string | null = null;
  let telefono: string | null = null;
  let dni: string | null = null;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!email) {
      const normalizedEmail = normalizeEmail(part);
      if (normalizedEmail) {
        email = normalizedEmail;
        parts.splice(index, 1);
        continue;
      }
    }

    if (!telefono) {
      const normalizedPhone = normalizePhone(part);
      if (normalizedPhone) {
        telefono = normalizedPhone;
        parts.splice(index, 1);
        continue;
      }
    }

    if (!dni) {
      const normalizedDni = normalizeDni(part);
      if (normalizedDni) {
        dni = normalizedDni;
        parts.splice(index, 1);
        continue;
      }
    }
  }

  if (parts.length < 2) {
    return null;
  }

  const nombre = parts[0];
  const apellido = normalizeWhitespace(parts.slice(1).join(' '));

  if (!nombre.length || !apellido.length) {
    return null;
  }

  if (!dni && !email && !telefono) {
    return null;
  }

  return { nombre, apellido, dni, email, telefono };
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
        const keys: string[] = [];
        if (identifier) {
          keys.push(`${identifier.type}|${identifier.value}`);
        }
        if (parsed.dni) {
          keys.push(`DNI|${parsed.dni}`);
        }
        if (parsed.email) {
          keys.push(`EMAIL|${parsed.email}`);
        }
        if (parsed.telefono) {
          keys.push(`PHONE|${parsed.telefono}`);
        }

        if (keys.some((key) => seen.has(key))) {
          return;
        }
        keys.forEach((key) => seen.add(key));

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
