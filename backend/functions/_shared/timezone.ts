// backend/functions/_shared/timezone.ts
const MADRID_TIME_ZONE = 'Europe/Madrid';
const FALLBACK_TIME_ZONE = 'UTC';

let timezonePrepared = false;

const formatterCache = new Map<string, { dateTime: Intl.DateTimeFormat; offset: Intl.DateTimeFormat }>();
const resolvedTimeZoneCache = new Map<string, string>();
const unsupportedTimeZones = new Set<string>();

function resolveTimeZone(timeZone: string): string {
  const cached = resolvedTimeZoneCache.get(timeZone);
  if (cached) return cached;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    resolvedTimeZoneCache.set(timeZone, timeZone);
    return timeZone;
  } catch (error) {
    if (error instanceof RangeError && timeZone !== FALLBACK_TIME_ZONE) {
      if (!unsupportedTimeZones.has(timeZone)) {
        unsupportedTimeZones.add(timeZone);
        console.warn(
          `[timezone] Time zone "${timeZone}" is not supported by the current Node runtime. Falling back to "${FALLBACK_TIME_ZONE}".`,
        );
      }

      const fallback = resolveTimeZone(FALLBACK_TIME_ZONE);
      resolvedTimeZoneCache.set(timeZone, fallback);
      return fallback;
    }

    throw error;
  }
}

export function ensureMadridTimezone(): void {
  if (timezonePrepared) return;

  const resolvedMadrid = resolveTimeZone(MADRID_TIME_ZONE);

  if (!process.env.TZ || process.env.TZ !== resolvedMadrid) {
    process.env.TZ = resolvedMadrid;
  }
  if (!process.env.PGTZ || process.env.PGTZ !== resolvedMadrid) {
    process.env.PGTZ = resolvedMadrid;
  }
  if (!process.env.PGOPTIONS) {
    process.env.PGOPTIONS = `-c TimeZone=${resolvedMadrid}`;
  } else if (!/TimeZone=/i.test(process.env.PGOPTIONS)) {
    process.env.PGOPTIONS = `${process.env.PGOPTIONS} -c TimeZone=${resolvedMadrid}`.trim();
  }

  timezonePrepared = true;
}

function getFormatters(timeZone: string) {
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const cached = formatterCache.get(resolvedTimeZone);
  if (cached) return cached;

  const dateTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  });

  const entry = { dateTime, offset };
  formatterCache.set(resolvedTimeZone, entry);
  return entry;
}

function extractOffsetMinutes(value: string): number {
  const match = value.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return 0;

  const sign = match[1].startsWith('-') ? -1 : 1;
  const hours = Math.abs(parseInt(match[1], 10));
  const minutes = match[2] ? parseInt(match[2], 10) : 0;

  return sign * (hours * 60 + minutes);
}

function formatDateToTimeZoneISO(date: Date, timeZone: string): string {
  try {
    const { dateTime, offset } = getFormatters(timeZone);
    const parts = dateTime.formatToParts(date);
    const values: Record<string, string> = {};

    for (const part of parts) {
      if (part.type !== 'literal') {
        values[part.type] = part.value;
      }
    }

    const year = values.year ?? '0000';
    const month = values.month ?? '01';
    const day = values.day ?? '01';
    const hour = values.hour ?? '00';
    const minute = values.minute ?? '00';
    const second = values.second ?? '00';
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

    const offsetParts = offset.formatToParts(date);
    const offsetName = offsetParts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00';
    const offsetMinutes = extractOffsetMinutes(offsetName);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
    const offsetMinutesStr = String(absoluteMinutes % 60).padStart(2, '0');

    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${sign}${offsetHours}:${offsetMinutesStr}`;
  } catch (error) {
    console.warn(
      `[timezone] Falling back to ISO string for timezone "${timeZone}" due to formatter error.`,
      error,
    );
    return date.toISOString();
  }
}

export function nowInMadridISO(): string {
  return formatDateToTimeZoneISO(new Date(), MADRID_TIME_ZONE);
}

export function nowInMadridDate(): Date {
  return new Date(nowInMadridISO());
}

export function toMadridISOString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return formatDateToTimeZoneISO(value, MADRID_TIME_ZONE);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return typeof value === 'string' ? value : null;
  }

  return formatDateToTimeZoneISO(parsed, MADRID_TIME_ZONE);
}

export function madridTimeZone(): string {
  return resolveTimeZone(MADRID_TIME_ZONE);
}
