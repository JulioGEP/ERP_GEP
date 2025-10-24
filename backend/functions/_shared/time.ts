// backend/functions/_shared/time.ts

function toTrimmedString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

const MADRID_TIMEZONE = 'Europe/Madrid';

const madridOffsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: MADRID_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'shortOffset',
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseOffsetMinutes(value: string): number {
  const match = value.match(/([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    return 0;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const sign = hours < 0 ? -1 : 1;
  return hours * 60 + sign * minutes;
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  return `${sign}${pad(hours)}:${pad(mins)}`;
}

function getMadridOffsetMinutes(year: number, month: number, day: number): number {
  const sample = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  const parts = madridOffsetFormatter.formatToParts(sample);
  const offsetName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC+0';
  return parseOffsetMinutes(offsetName);
}

export function buildMadridDateTime({
  year,
  month,
  day,
  hour,
  minute,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): Date {
  const offsetMinutes = getMadridOffsetMinutes(year, month, day);
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${formatOffset(offsetMinutes)}`;
  return new Date(iso);
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
