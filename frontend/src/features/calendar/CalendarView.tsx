// frontend/src/features/calendar/CalendarView.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, Spinner } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { fetchCalendarSessions, type CalendarResource, type CalendarSession } from './api';
import type { SessionEstado } from '../presupuestos/api';
import { ApiError } from '../presupuestos/api';

const STORAGE_KEY_PREFIX = 'erp-calendar-preferences';
const MADRID_TZ = 'Europe/Madrid';
const FETCH_PADDING_DAYS = 14;
const DEBOUNCE_MS = 220;
const MIN_EVENT_HEIGHT = 3; // %
const DAY_MINUTES = 24 * 60;
const VISIBLE_DAY_START_HOUR = 5;
const VISIBLE_DAY_END_HOUR = 24;
const VISIBLE_DAY_START_MINUTES = VISIBLE_DAY_START_HOUR * 60;
const VISIBLE_DAY_END_MINUTES = VISIBLE_DAY_END_HOUR * 60;
const VISIBLE_DAY_DURATION_MINUTES = VISIBLE_DAY_END_MINUTES - VISIBLE_DAY_START_MINUTES;
const VISIBLE_DAY_HOURS = Array.from(
  { length: VISIBLE_DAY_END_HOUR - VISIBLE_DAY_START_HOUR + 1 },
  (_, index) => VISIBLE_DAY_START_HOUR + index,
);

const SESSION_ESTADO_LABELS: Record<SessionEstado, string> = {
  BORRADOR: 'Borrador',
  PLANIFICADA: 'Planificada',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  FINALIZADA: 'Finalizada',
};

const SESSION_CLASSNAMES: Record<SessionEstado, string> = {
  BORRADOR: 'estado-borrador',
  PLANIFICADA: 'estado-planificada',
  SUSPENDIDA: 'estado-suspendida',
  CANCELADA: 'estado-cancelada',
  FINALIZADA: 'estado-finalizada',
};

type CalendarViewType = 'month' | 'week' | 'day';
type CalendarMode = 'sessions' | 'trainers' | 'units';

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type CalendarViewProps = {
  onNotify?: (toast: ToastParams) => void;
  onSessionOpen?: (session: CalendarSession) => void;
  title?: string;
  mode?: CalendarMode;
  initialView?: CalendarViewType;
};

type MadridDate = { year: number; month: number; day: number };
type MadridDateTime = MadridDate & { hour: number; minute: number; offsetMinutes: number };

type VisibleRange = {
  startJulian: number;
  endJulian: number; // exclusive
  labelStartJulian: number;
  labelEndJulian: number; // exclusive
  startDateUTC: Date;
  endDateUTC: Date;
};

type MonthDayCell = {
  julian: number;
  date: MadridDate;
  iso: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  sessions: CalendarSession[];
};

type DayEvent = {
  session: CalendarSession;
  startMinutes: number;
  endMinutes: number;
  topPercent: number;
  heightPercent: number;
  column: number;
  columns: number;
  displayStart: string;
  displayEnd: string;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
};

type WeekColumn = {
  julian: number;
  date: MadridDate;
  iso: string;
  label: string;
  weekdayLabel: string;
  isToday: boolean;
  events: DayEvent[];
};

const madridDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: MADRID_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
  timeZoneName: 'shortOffset',
});

const madridDateFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const madridWeekdayFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TZ,
  weekday: 'short',
});

const madridTimeFormatter = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TZ,
  hour: '2-digit',
  minute: '2-digit',
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseOffset(value: string): number {
  const match = value.match(/([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const sign = hours < 0 ? -1 : 1;
  return hours * 60 + sign * minutes;
}

function getMadridDateTime(date: Date): MadridDateTime {
  const parts = madridDateTimeFormatter.formatToParts(date);
  const getValue = (type: Intl.DateTimeFormatPartTypes): number =>
    parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  const offsetName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC+0';
  return {
    year: getValue('year'),
    month: getValue('month'),
    day: getValue('day'),
    hour: getValue('hour'),
    minute: getValue('minute'),
    offsetMinutes: parseOffset(offsetName),
  };
}

function getMadridOffset(date: MadridDate): number {
  const middayUTC = new Date(Date.UTC(date.year, date.month - 1, date.day, 12, 0));
  return getMadridDateTime(middayUTC).offsetMinutes;
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${pad(hours)}:${pad(mins)}`;
}

function madridDateToUTC(date: MadridDate, hour = 0, minute = 0): Date {
  const offset = getMadridOffset(date);
  const iso = `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(hour)}:${pad(minute)}:00${formatOffset(offset)}`;
  return new Date(iso);
}

function getJulianDay(date: MadridDate): number {
  const { year, month, day } = date;
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function julianToMadridDate(julian: number): MadridDate {
  let j = julian + 68569;
  const c = Math.floor((4 * j) / 146097);
  j = j - Math.floor((146097 * c + 3) / 4);
  const d = Math.floor((4000 * (j + 1)) / 1461001);
  j = j - Math.floor((1461 * d) / 4) + 31;
  const m = Math.floor((80 * j) / 2447);
  const day = j - Math.floor((2447 * m) / 80);
  j = Math.floor(m / 11);
  const month = m + 2 - 12 * j;
  const year = 100 * (c - 49) + d + j;
  return { year, month, day };
}

function getMadridWeekday(date: MadridDate): number {
  const utc = madridDateToUTC(date, 12, 0);
  const weekday = utc.getUTCDay();
  return (weekday + 6) % 7; // Monday = 0
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatToolbarLabel(view: CalendarViewType, range: VisibleRange): string {
  if (view === 'month') {
    const start = madridDateToUTC(julianToMadridDate(range.labelStartJulian));
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: MADRID_TZ,
      month: 'long',
      year: 'numeric',
    }).format(start);
  }
  const start = madridDateToUTC(julianToMadridDate(range.labelStartJulian));
  const endExclusive = madridDateToUTC(julianToMadridDate(range.labelEndJulian));
  if (view === 'day') {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: MADRID_TZ,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(start);
  }
  const end = new Date(endExclusive.getTime() - 1);
  const formatter = new Intl.DateTimeFormat('es-ES', {
    timeZone: MADRID_TZ,
    day: '2-digit',
    month: 'short',
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function readStoredPreferences(
  storageKey: string,
  fallbackView: CalendarViewType,
): { view: CalendarViewType; date: Date } {
  const today = new Date();
  if (typeof window === 'undefined') {
    return { view: fallbackView, date: today };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { view: fallbackView, date: today };
    }
    const parsed = JSON.parse(raw);
    const view =
      parsed?.view === 'week' || parsed?.view === 'day' || parsed?.view === 'month'
        ? (parsed.view as CalendarViewType)
        : fallbackView;
    return { view, date: today };
  } catch {
    return { view: fallbackView, date: today };
  }
}

function computeVisibleRange(view: CalendarViewType, reference: Date): VisibleRange {
  const parts = getMadridDateTime(reference);
  const current: MadridDate = { year: parts.year, month: parts.month, day: parts.day };
  if (view === 'month') {
    const firstDay: MadridDate = { year: current.year, month: current.month, day: 1 };
    const firstJulian = getJulianDay(firstDay);
    const weekday = getMadridWeekday(firstDay);
    const startJulian = firstJulian - weekday;
    const endJulian = startJulian + 42;
    const daysInCurrentMonth = getDaysInMonth(current.year, current.month);
    return {
      startJulian,
      endJulian,
      labelStartJulian: firstJulian,
      labelEndJulian: firstJulian + daysInCurrentMonth,
      startDateUTC: madridDateToUTC(julianToMadridDate(startJulian)),
      endDateUTC: madridDateToUTC(julianToMadridDate(endJulian)),
    };
  }
  const currentJulian = getJulianDay(current);
  const shift = view === 'week' ? getMadridWeekday(current) : 0;
  const startJulian = view === 'week' ? currentJulian - shift : currentJulian;
  const duration = view === 'week' ? 7 : 1;
  return {
    startJulian,
    endJulian: startJulian + duration,
    labelStartJulian: startJulian,
    labelEndJulian: startJulian + duration,
    startDateUTC: madridDateToUTC(julianToMadridDate(startJulian)),
    endDateUTC: madridDateToUTC(julianToMadridDate(startJulian + duration)),
  };
}

function buildChipLabel(type: 'room' | 'trainer' | 'unit', label: string, extra = 0) {
  const icon = type === 'room' ? '🏢' : type === 'trainer' ? '🧑‍🏫' : '🚐';
  return `${icon} ${extra > 0 ? `${label} +${extra}` : label}`;
}

function formatResourceName(resource: CalendarResource): string {
  const secondary = resource.secondary?.trim();
  return secondary?.length ? `${resource.name} ${secondary}`.trim() : resource.name;
}

function formatResourceSummary(resources: CalendarResource[], emptyLabel: string): string {
  if (!resources.length) return emptyLabel;
  const [first, ...rest] = resources;
  const base = formatResourceName(first);
  return rest.length ? `${base} +${rest.length}` : base;
}

function formatResourceDetail(resources: CalendarResource[], emptyLabel: string): string {
  if (!resources.length) return emptyLabel;
  return resources.map((resource) => formatResourceName(resource)).join(', ');
}

function groupSessionsByJulian(sessions: CalendarSession[]): Map<number, CalendarSession[]> {
  const map = new Map<number, CalendarSession[]>();
  sessions.forEach((session) => {
    const start = getMadridDateTime(new Date(session.start));
    const end = getMadridDateTime(new Date(session.end));
    let startJulian = getJulianDay(start);
    let endJulian = getJulianDay(end);
    if (endJulian > startJulian && end.hour === 0 && end.minute === 0) {
      endJulian -= 1;
    }
    for (let jd = startJulian; jd <= endJulian; jd += 1) {
      const list = map.get(jd) ?? [];
      list.push(session);
      map.set(jd, list);
    }
  });
  return map;
}

function arrangeDayEvents(events: DayEvent[]): DayEvent[] {
  const sorted = [...events].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.endMinutes - b.endMinutes;
  });
  const active: DayEvent[] = [];
  let groupId = 0;
  const groupColumns = new Map<number, number>();
  const groups = new Map<DayEvent, number>();

  sorted.forEach((event) => {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].endMinutes <= event.startMinutes) {
        active.splice(i, 1);
      }
    }
    if (active.length === 0) {
      groupId += 1;
    }
    groups.set(event, groupId);
    const used = new Set(active.map((item) => item.column));
    let column = 0;
    while (used.has(column)) {
      column += 1;
    }
    event.column = column;
    active.push(event);
    const currentMax = groupColumns.get(groupId) ?? 0;
    groupColumns.set(groupId, Math.max(currentMax, column + 1));
  });

  sorted.forEach((event) => {
    const id = groups.get(event) ?? 1;
    event.columns = groupColumns.get(id) ?? 1;
  });

  return sorted;
}

function buildWeekColumns(range: VisibleRange, sessions: CalendarSession[]): WeekColumn[] {
  const columns: WeekColumn[] = [];
  const todayParts = getMadridDateTime(new Date());
  for (let jd = range.startJulian; jd < range.endJulian; jd += 1) {
    const date = julianToMadridDate(jd);
    const iso = madridDateToUTC(date).toISOString();
    const weekdayLabel = madridWeekdayFormatter.format(madridDateToUTC(date));
    const label = madridDateFormatter.format(madridDateToUTC(date));
    const isToday = date.year === todayParts.year && date.month === todayParts.month && date.day === todayParts.day;
    columns.push({
      julian: jd,
      date,
      iso,
      label,
      weekdayLabel,
      isToday,
      events: [],
    });
  }

  const weekStartUTC = madridDateToUTC(julianToMadridDate(range.startJulian));
  const weekEndUTC = madridDateToUTC(julianToMadridDate(range.endJulian));

  const filtered = sessions.filter((session) => {
    const start = new Date(session.start);
    const end = new Date(session.end);
    return end > weekStartUTC && start < weekEndUTC;
  });

  columns.forEach((column, index) => {
    const dayStart = madridDateToUTC(column.date);
    const dayEnd = madridDateToUTC(julianToMadridDate(column.julian + 1));
    const dayEvents: DayEvent[] = [];

    filtered.forEach((session) => {
      const start = new Date(session.start);
      const end = new Date(session.end);
      if (end <= dayStart || start >= dayEnd) return;
      const continuesFromPreviousDay = start < dayStart;
      const continuesIntoNextDay = end > dayEnd;
      const overlapStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
      const overlapEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
      const startParts = getMadridDateTime(overlapStart);
      const endParts = getMadridDateTime(overlapEnd);
      let startMinutes = startParts.hour * 60 + startParts.minute;
      let endMinutes = endParts.hour * 60 + endParts.minute;

      if (continuesFromPreviousDay) {
        startMinutes = 0;
      }

      if (continuesIntoNextDay) {
        endMinutes = DAY_MINUTES;
      }

      if (endMinutes <= startMinutes) {
        endMinutes = Math.min(DAY_MINUTES, startMinutes + 30);
      }

      const clippedAtStart = startMinutes < VISIBLE_DAY_START_MINUTES;
      const clippedAtEnd = endMinutes > VISIBLE_DAY_END_MINUTES;
      const visibleStartMinutes = Math.min(
        Math.max(startMinutes, VISIBLE_DAY_START_MINUTES),
        VISIBLE_DAY_END_MINUTES,
      );
      const visibleEndMinutes = Math.min(
        Math.max(endMinutes, visibleStartMinutes),
        VISIBLE_DAY_END_MINUTES,
      );
      const visibleDuration = Math.max(visibleEndMinutes - visibleStartMinutes, 0);
      const topPercent = ((visibleStartMinutes - VISIBLE_DAY_START_MINUTES) / VISIBLE_DAY_DURATION_MINUTES) * 100;
      const heightPercent = Math.max(
        (visibleDuration / VISIBLE_DAY_DURATION_MINUTES) * 100,
        MIN_EVENT_HEIGHT,
      );
      const displayStart = continuesFromPreviousDay
        ? '00:00'
        : madridTimeFormatter.format(overlapStart);
      const displayEnd = continuesIntoNextDay ? '24:00' : madridTimeFormatter.format(overlapEnd);
      dayEvents.push({
        session,
        startMinutes,
        endMinutes,
        topPercent,
        heightPercent,
        column: 0,
        columns: 1,
        displayStart,
        displayEnd,
        continuesFromPreviousDay: continuesFromPreviousDay || clippedAtStart,
        continuesIntoNextDay: continuesIntoNextDay || clippedAtEnd,
      });
    });

    column.events = arrangeDayEvents(dayEvents);
  });

  return columns;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function CalendarView({
  onNotify,
  onSessionOpen,
  title = 'Calendario',
  mode = 'sessions',
  initialView = 'month',
}: CalendarViewProps) {
  const storageKey = `${STORAGE_KEY_PREFIX}-${mode}`;
  const stored = useMemo(() => readStoredPreferences(storageKey, initialView), [storageKey, initialView]);
  const [view, setView] = useState<CalendarViewType>(stored.view);
  const [currentDate, setCurrentDate] = useState<Date>(stored.date);
  const [visibleRange, setVisibleRange] = useState<VisibleRange>(() => computeVisibleRange(stored.view, stored.date));
  const debouncedRange = useDebouncedValue(visibleRange, DEBOUNCE_MS);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextRange = computeVisibleRange(view, currentDate);
    setVisibleRange(nextRange);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ view, date: currentDate.toISOString() }),
        );
      }
    } catch {
      /* ignore storage errors */
    }
  }, [view, currentDate, storageKey]);

  const fetchRange = useMemo(() => {
    if (!debouncedRange) return null;
    const startJulian = debouncedRange.startJulian - FETCH_PADDING_DAYS;
    const endJulian = debouncedRange.endJulian + FETCH_PADDING_DAYS;
    return {
      start: madridDateToUTC(julianToMadridDate(startJulian)).toISOString(),
      end: madridDateToUTC(julianToMadridDate(endJulian)).toISOString(),
    };
  }, [debouncedRange]);

  const sessionsQuery = useQuery({
    queryKey: ['calendarSessions', fetchRange?.start ?? null, fetchRange?.end ?? null],
    queryFn: () => fetchCalendarSessions({ start: fetchRange!.start, end: fetchRange!.end }),
    enabled: !!fetchRange,
    keepPreviousData: true,
    staleTime: 5 * 60 * 1000,
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const sessionGroups = useMemo(() => groupSessionsByJulian(sessions), [sessions]);

  const monthDays: MonthDayCell[] | null = useMemo(() => {
    if (view !== 'month') return null;
    const days: MonthDayCell[] = [];
    const todayParts = getMadridDateTime(new Date());
    for (let jd = visibleRange.startJulian; jd < visibleRange.endJulian; jd += 1) {
      const date = julianToMadridDate(jd);
      const iso = madridDateToUTC(date).toISOString();
      const isCurrentMonth = date.month === getMadridDateTime(currentDate).month;
      const isToday =
        date.year === todayParts.year && date.month === todayParts.month && date.day === todayParts.day;
      days.push({
        julian: jd,
        date,
        iso,
        isCurrentMonth,
        isToday,
        sessions: [...(sessionGroups.get(jd) ?? [])].sort((a, b) => a.start.localeCompare(b.start)),
      });
    }
    return days;
  }, [view, visibleRange, currentDate, sessionGroups]);

  const weekColumns = useMemo(() => {
    if (view === 'month') return null;
    return buildWeekColumns(visibleRange, sessions);
  }, [view, visibleRange, sessions]);

  const isInitialLoading = sessionsQuery.isLoading && !sessionsQuery.data;
  const isFetching = sessionsQuery.isFetching;
  const error = sessionsQuery.error as ApiError | null;

  const handleViewChange = useCallback((nextView: CalendarViewType) => {
    setView(nextView);
  }, []);

  const moveDate = useCallback(
    (direction: 1 | -1) => {
      const parts = getMadridDateTime(currentDate);
      let target: MadridDate;
      if (view === 'month') {
        const month = parts.month + direction;
        const year = parts.year + Math.floor((month - 1) / 12);
        const normalizedMonth = ((month - 1 + 12 * 1000) % 12) + 1;
        const daysInTarget = getDaysInMonth(year, normalizedMonth);
        const day = Math.min(parts.day, daysInTarget);
        target = { year, month: normalizedMonth, day };
      } else if (view === 'week') {
        const julian = getJulianDay({ year: parts.year, month: parts.month, day: parts.day }) + direction * 7;
        target = julianToMadridDate(julian);
      } else {
        const julian = getJulianDay({ year: parts.year, month: parts.month, day: parts.day }) + direction;
        target = julianToMadridDate(julian);
      }
      setCurrentDate(madridDateToUTC(target, 12, 0));
    },
    [currentDate, view],
  );

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const [tooltip, setTooltip] = useState<
    | {
        session: CalendarSession;
        rect: DOMRect;
        pointer?: { x: number; y: number };
      }
    | null
  >(null);

  const tooltipStartLabel = tooltip
    ? `${madridDateFormatter.format(new Date(tooltip.session.start))} · ${madridTimeFormatter.format(
        new Date(tooltip.session.start),
      )}`
    : '';
  const tooltipEndLabel = tooltip
    ? `${madridDateFormatter.format(new Date(tooltip.session.end))} · ${madridTimeFormatter.format(
        new Date(tooltip.session.end),
      )}`
    : '';
  const tooltipCompanyLabel = tooltip?.session.dealTitle?.trim() || 'Sin empresa';
  const tooltipAddressLabel =
    tooltip?.session.dealAddress?.trim() || tooltip?.session.direccion?.trim() || 'Sin dirección';
  const tooltipTrainersLabel =
    tooltip && tooltip.session.trainers.length
      ? tooltip.session.trainers
          .map((trainer) =>
            trainer.secondary ? `${trainer.name} ${trainer.secondary}`.trim() : trainer.name,
          )
          .join(', ')
      : 'Sin formador';
  const tooltipUnitsLabel =
    tooltip && tooltip.session.units.length
      ? tooltip.session.units
          .map((unit) => (unit.secondary ? `${unit.name} ${unit.secondary}`.trim() : unit.name))
          .join(', ')
      : 'Sin unidad móvil';

  const wrapperRect = wrapperRef.current?.getBoundingClientRect() ?? null;
  const tooltipStyle = tooltip
    ? wrapperRect
      ? tooltip.pointer
        ? {
            top: `${tooltip.pointer.y - wrapperRect.top}px`,
            left: `${tooltip.pointer.x - wrapperRect.left}px`,
          }
        : {
            top: `${tooltip.rect.top - wrapperRect.top}px`,
            left: `${tooltip.rect.left - wrapperRect.left + tooltip.rect.width / 2}px`,
          }
      : tooltip.pointer
        ? {
            top: `${tooltip.pointer.y + window.scrollY}px`,
            left: `${tooltip.pointer.x + window.scrollX}px`,
          }
        : {
            top: `${tooltip.rect.top + window.scrollY}px`,
            left: `${tooltip.rect.left + window.scrollX + tooltip.rect.width / 2}px`,
          }
    : undefined;

  const handleEventDragEnd = useCallback(() => {
    onNotify?.({
      variant: 'info',
      message: 'La edición de sesiones desde el calendario estará disponible próximamente.',
    });
  }, [onNotify]);

  const renderSessionContent = (session: CalendarSession) => {
    const chips: string[] = [];
    if (mode === 'sessions') {
      if (session.room) {
        chips.push(buildChipLabel('room', session.room.name));
      }
      if (session.trainers.length) {
        const [first, ...rest] = session.trainers;
        chips.push(buildChipLabel('trainer', formatResourceName(first), rest.length));
      }
      if (session.units.length) {
        const [first, ...rest] = session.units;
        chips.push(buildChipLabel('unit', formatResourceName(first), rest.length));
      }
    } else if (mode === 'trainers') {
      if (session.trainers.length > 1) {
        session.trainers.slice(1).forEach((trainer) => {
          chips.push(buildChipLabel('trainer', formatResourceName(trainer)));
        });
      }
    } else if (mode === 'units') {
      if (session.units.length > 1) {
        session.units.slice(1).forEach((unit) => {
          chips.push(buildChipLabel('unit', formatResourceName(unit)));
        });
      }
    }

    const eventTitle =
      mode === 'sessions'
        ? session.dealPipelineId ?? session.title
        : mode === 'trainers'
        ? formatResourceSummary(session.trainers, 'Sin formador')
        : formatResourceSummary(session.units, 'Sin unidad móvil');

    return (
      <div className="erp-calendar-event-content">
        <div className="erp-calendar-event-title">{eventTitle}</div>
        {chips.length ? (
          <div className="erp-calendar-event-meta">
            {chips.map((chip, index) => (
              <span key={`${chip}-${index}`} className="erp-calendar-chip">
                {chip}
              </span>
            ))}
          </div>
        ) : null}
        <span className="erp-calendar-event-status">
          {SESSION_ESTADO_LABELS[session.estado] ?? session.estado}
        </span>
      </div>
    );
  };

  const isDayView = view === 'day';

  return (
    <section className="d-grid gap-4">
      <header className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">{title}</h1>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <Button variant="outline-secondary" className="fw-semibold" onClick={handleToday}>
            Hoy
          </Button>
          <div className="erp-calendar-nav">
            <Button variant="outline-secondary" onClick={() => moveDate(-1)} aria-label="Anterior">
              ←
            </Button>
            <Button variant="outline-secondary" onClick={() => moveDate(1)} aria-label="Siguiente">
              →
            </Button>
          </div>
          <ButtonGroup>
            <Button
              variant={view === 'month' ? 'primary' : 'outline-secondary'}
              onClick={() => handleViewChange('month')}
            >
              Mes
            </Button>
            <Button
              variant={view === 'week' ? 'primary' : 'outline-secondary'}
              onClick={() => handleViewChange('week')}
            >
              Semana
            </Button>
            <Button
              variant={view === 'day' ? 'primary' : 'outline-secondary'}
              onClick={() => handleViewChange('day')}
            >
              Día
            </Button>
          </ButtonGroup>
        </div>
      </header>

      {error ? (
        <Alert variant="danger" className="mb-0">
          <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
            <div>
              <strong className="d-block mb-1">No se pudo cargar el calendario</strong>
              <span className="small">{error.message}</span>
            </div>
            <Button size="sm" variant="outline-danger" onClick={() => sessionsQuery.refetch()}>
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="erp-calendar-surface">
        <div className="erp-calendar-toolbar-title">{formatToolbarLabel(view, visibleRange)}</div>
        <div className="erp-calendar-wrapper" ref={wrapperRef}>
          {(isInitialLoading || isFetching) && (
            <div className="erp-calendar-loading" role="status" aria-live="polite">
              <Spinner animation="border" variant="danger" />
              <span className="visually-hidden">Cargando sesiones...</span>
            </div>
          )}

          {view === 'month' && monthDays ? (
            <div className="erp-calendar-month-grid">
              <div className="erp-calendar-month-header">
                {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label) => (
                  <div key={label} className="erp-calendar-month-header-cell">
                    {label}
                  </div>
                ))}
              </div>
              <div className="erp-calendar-month-body">
                {monthDays.map((day) => (
                  <div
                    key={day.iso}
                    className={`erp-calendar-day-cell ${
                      day.isCurrentMonth ? '' : 'is-muted'
                    } ${day.isToday ? 'is-today' : ''}`}
                  >
                    <div className="erp-calendar-day-label">{day.date.day}</div>
                    <div className="erp-calendar-day-events">
                      {day.sessions.map((session) => {
                        const monthEventLabel =
                          mode === 'sessions'
                            ? session.dealPipelineId ?? session.title
                            : mode === 'trainers'
                            ? formatResourceSummary(session.trainers, 'Sin formador')
                            : formatResourceSummary(session.units, 'Sin unidad móvil');
                        const monthEventTitle =
                          mode === 'sessions'
                            ? session.dealPipelineId ?? session.title
                            : mode === 'trainers'
                            ? formatResourceDetail(session.trainers, 'Sin formador')
                            : formatResourceDetail(session.units, 'Sin unidad móvil');
                        return (
                          <div
                            key={session.id}
                            className={`erp-calendar-event erp-calendar-month-event ${SESSION_CLASSNAMES[session.estado]}`}
                            role="button"
                            tabIndex={0}
                            draggable
                            title={monthEventTitle}
                            onClick={() => onSessionOpen?.(session)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onSessionOpen?.(session);
                              }
                            }}
                            onDragEnd={handleEventDragEnd}
                            onMouseEnter={(event) => {
                              const target = event.currentTarget;
                              if (!target) return;
                              setTooltip({ session, rect: target.getBoundingClientRect() });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                            onFocus={(event) => {
                              const target = event.currentTarget;
                              if (!target) return;
                              setTooltip({ session, rect: target.getBoundingClientRect() });
                            }}
                            onBlur={() => setTooltip(null)}
                          >
                            <span className="erp-calendar-month-event-dot" aria-hidden="true" />
                            <span className="erp-calendar-month-event-text">{monthEventLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : view !== 'month' && weekColumns ? (
            <div className={`erp-calendar-week-layout ${isDayView ? 'is-day-view' : ''}`}>
              <div className="erp-calendar-week-hours">
                {VISIBLE_DAY_HOURS.map((hour) => (
                  <div key={hour} className="erp-calendar-hour-slot">
                    <span>{pad(hour)}:00</span>
                  </div>
                ))}
              </div>
              <div className={`erp-calendar-week-columns ${isDayView ? 'is-day-view' : ''}`}>
                {weekColumns.map((column) => (
                  <div
                    key={column.iso}
                    className={`erp-calendar-week-column ${column.isToday ? 'is-today' : ''} ${
                      isDayView ? 'is-day-view' : ''
                    }`}
                  >
                    <div className="erp-calendar-week-column-header">
                      <span className="erp-calendar-weekday">{column.weekdayLabel}</span>
                      <span className="erp-calendar-weekdate">{column.label}</span>
                    </div>
                    <div className="erp-calendar-week-column-body">
                      {column.events.map((event) => (
                        <div
                          key={`${event.session.id}-${event.startMinutes}`}
                          className={`erp-calendar-event erp-calendar-week-event ${SESSION_CLASSNAMES[event.session.estado]} ${
                            event.continuesFromPreviousDay ? 'is-continued-from-previous-day' : ''
                          } ${event.continuesIntoNextDay ? 'is-continued-into-next-day' : ''}`}
                          role="button"
                          tabIndex={0}
                          style={{
                            top: `${event.topPercent}%`,
                            height: `${event.heightPercent}%`,
                            left: `${(event.column / event.columns) * 100}%`,
                            width: `${100 / event.columns}%`,
                          }}
                          draggable
                          onClick={() => onSessionOpen?.(event.session)}
                          onKeyDown={(keyboardEvent) => {
                            if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                              keyboardEvent.preventDefault();
                              onSessionOpen?.(event.session);
                            }
                          }}
                          onDragEnd={handleEventDragEnd}
                          onMouseEnter={(evt) => {
                            const target = evt.currentTarget;
                            if (!target) return;
                            setTooltip({
                              session: event.session,
                              rect: target.getBoundingClientRect(),
                              pointer: { x: evt.clientX, y: evt.clientY },
                            });
                          }}
                          onMouseMove={(evt) => {
                            const target = evt.currentTarget;
                            if (!target) return;
                            setTooltip((current) =>
                              current && current.session.id === event.session.id
                                ? {
                                    session: event.session,
                                    rect: target.getBoundingClientRect(),
                                    pointer: { x: evt.clientX, y: evt.clientY },
                                  }
                                : current,
                            );
                          }}
                          onMouseLeave={() => setTooltip(null)}
                          onFocus={(evt) => {
                            const target = evt.currentTarget;
                            if (!target) return;
                            setTooltip({ session: event.session, rect: target.getBoundingClientRect() });
                          }}
                          onBlur={() => setTooltip(null)}
                        >
                          <div className="erp-calendar-event-time">{event.displayStart} - {event.displayEnd}</div>
                          {renderSessionContent(event.session)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tooltip ? (
            <div className="erp-calendar-tooltip-overlay" style={tooltipStyle}>
              <div className="erp-calendar-tooltip-content">
                <div className="erp-calendar-tooltip-title">{tooltip.session.title}</div>
                <div className="erp-calendar-tooltip-line">
                  {tooltipStartLabel} - {tooltipEndLabel}
                </div>
                <div className="erp-calendar-tooltip-line">
                  {tooltipCompanyLabel} - {tooltipAddressLabel}
                </div>
                <div className="erp-calendar-tooltip-line">
                  {tooltipTrainersLabel} - {tooltipUnitsLabel}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
