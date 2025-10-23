// backend/functions/_shared/time.ts

function toTrimmedString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

export function formatTimeFromDb(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  const text = toTrimmedString(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const [, hours, minutes] = match;
    return `${hours}:${minutes}`;
  }

  return text;
}

export function parseHHMMToDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const text = toTrimmedString(value);

  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('INVALID_TIME');
  }

  const [, hoursText, minutesText] = match;
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error('INVALID_TIME');
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('INVALID_TIME');
  }

  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
}
