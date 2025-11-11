// frontend/src/utils/dealNotes.ts

export type DealNoteLike = { content?: string | null } | null | undefined;

const removeDiacritics = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalizeForMatch = (value: string): string =>
  removeDiacritics(value).toLowerCase().trim();

const HIDDEN_NOTE_PATTERNS = ['detalles del documentacion', 'alumnos del deal'];

export const shouldHideDealNoteContent = (content: string | null | undefined): boolean => {
  if (!content) return false;
  const normalized = normalizeForMatch(content);
  if (!normalized.length) return false;
  return HIDDEN_NOTE_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const filterDealNotesForDisplay = <T extends { content?: string | null }>(
  notes: readonly T[] | null | undefined,
): T[] => {
  if (!Array.isArray(notes)) return [];
  return notes.filter((note) => !shouldHideDealNoteContent(note?.content));
};
