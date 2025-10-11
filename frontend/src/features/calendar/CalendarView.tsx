// frontend/src/features/calendar/CalendarView.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, ButtonGroup, Spinner } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { fetchCalendarSessions, type CalendarSession } from './api';
import type { SessionEstado } from '../presupuestos/api';
import { ApiError } from '../presupuestos/api';

const STORAGE_KEY = 'erp-calendar-preferences';
const MADRID_TZ = 'Europe/Madrid';
const FETCH_PADDING_DAYS = 14;
const DEBOUNCE_MS = 220;
const MIN_EVENT_HEIGHT = 3; // %
const DAY_MINUTES = 24 * 60;

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

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type CalendarViewProps = {
  onNotify?: (toast: ToastParams) => void;
  onSessionOpen?: (session: CalendarSession) => void;
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

function readStoredPreferences(): { view: CalendarViewType; date: Date } {
  if (typeof window === 'undefined') {
    return { view: 'month', date: new Date() };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { view: 'month', date: new Date() };
    }
    const parsed = JSON.parse(raw);
    const view = parsed?.view === 'week' || parsed?.view === 'day' ? parsed.view : 'month';
    const date = parsed?.date ? new Date(parsed.date) : new Date();
    return Number.isFinite(date.getTime()) ? { view, date } : { view, date: new Date() };
  } catch {
    return { view: 'month', date: new Date() };
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
      const overlapStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
      const overlapEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
      const startParts = getMadridDateTime(overlapStart);
      const endParts = getMadridDateTime(overlapEnd);
      let startMinutes = startParts.hour * 60 + startParts.minute;
      let endMinutes = endParts.hour * 60 + endParts.minute;
      if (endMinutes <= startMinutes) {
        endMinutes = startMinutes + 30;
      }
      const duration = Math.max(endMinutes - startMinutes, 30);
      const topPercent = (startMinutes / DAY_MINUTES) * 100;
      const heightPercent = Math.max((duration / DAY_MINUTES) * 100, MIN_EVENT_HEIGHT);
      dayEvents.push({
        session,
        startMinutes,
        endMinutes,
        topPercent,
        heightPercent,
        column: 0,
        columns: 1,
        displayStart: madridTimeFormatter.format(overlapStart),
        displayEnd: madridTimeFormatter.format(overlapEnd),
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

export function CalendarView({ onNotify, onSessionOpen }: CalendarViewProps) {
  const stored = useMemo(() => readStoredPreferences(), []);
  const [view, setView] = useState<CalendarViewType>(stored.view);
  const [currentDate, setCurrentDate] = useState<Date>(stored.date);
  const [visibleRange, setVisibleRange] = useState<VisibleRange>(() => computeVisibleRange(stored.view, stored.date));
  const debouncedRange = useDebouncedValue(visibleRange, DEBOUNCE_MS);

  useEffect(() => {
    const nextRange = computeVisibleRange(view, currentDate);
    setVisibleRange(nextRange);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ view, date: currentDate.toISOString() }),
        );
      }
    } catch {
      /* ignore storage errors */
    }
  }, [view, currentDate]);

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

  const [tooltip, setTooltip] = useState<{ session: CalendarSession; rect: DOMRect } | null>(null);

  const handleEventDragEnd = useCallback(() => {
    onNotify?.({
      variant: 'info',
      message: 'La edición de sesiones desde el calendario estará disponible próximamente.',
    });
  }, [onNotify]);

  const renderSessionContent = (session: CalendarSession) => {
    const chips: string[] = [];
    if (session.room) {
      chips.push(buildChipLabel('room', session.room.name));
    }
    if (session.trainers.length) {
      const [first, ...rest] = session.trainers;
      const label = first.secondary ? `${first.name} ${first.secondary}`.trim() : first.name;
      chips.push(buildChipLabel('trainer', label, rest.length));
    }
    if (session.units.length) {
      const [first, ...rest] = session.units;
      const label = first.secondary ? `${first.name} ${first.secondary}`.trim() : first.name;
      chips.push(buildChipLabel('unit', label, rest.length));
    }
    return (
      <div className="erp-calendar-event-content">
        <div className="erp-calendar-event-title">{session.title}</div>
        <div className="erp-calendar-event-meta">
          {chips.map((chip) => (
            <span key={chip} className="erp-calendar-chip">
              {chip}
            </span>
          ))}
        </div>
        <span className="erp-calendar-event-status">
          {SESSION_ESTADO_LABELS[session.estado] ?? session.estado}
        </span>
      </div>
    );
  };

  return (
    <section className="d-grid gap-4">
      <header className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Calendario</h1>
          <p className="text-muted mb-0">Visualiza las sesiones en horario Europe/Madrid</p>
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
        <div className="erp-calendar-wrapper">
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
                      {day.sessions.map((session) => (
                        <div
                          key={session.id}
                          className={`erp-calendar-event ${SESSION_CLASSNAMES[session.estado]}`}
                          role="button"
                          tabIndex={0}
                          draggable
                          onClick={() => onSessionOpen?.(session)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onSessionOpen?.(session);
                            }
                          }}
                          onDragEnd={handleEventDragEnd}
                          onMouseEnter={(event) =>
                            setTooltip({ session, rect: event.currentTarget.getBoundingClientRect() })
                          }
                          onMouseLeave={() => setTooltip(null)}
                          onFocus={(event) =>
                            setTooltip({ session, rect: event.currentTarget.getBoundingClientRect() })
                          }
                          onBlur={() => setTooltip(null)}
                        >
                          {renderSessionContent(session)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : view !== 'month' && weekColumns ? (
            <div className="erp-calendar-week-layout">
              <div className="erp-calendar-week-hours">
                {Array.from({ length: 24 }).map((_, index) => (
                  <div key={index} className="erp-calendar-hour-slot">
                    <span>{pad(index)}:00</span>
                  </div>
                ))}
              </div>
              <div className="erp-calendar-week-columns">
                {weekColumns.map((column) => (
                  <div
                    key={column.iso}
                    className={`erp-calendar-week-column ${column.isToday ? 'is-today' : ''}`}
                  >
                    <div className="erp-calendar-week-column-header">
                      <span className="erp-calendar-weekday">{column.weekdayLabel}</span>
                      <span className="erp-calendar-weekdate">{column.label}</span>
                    </div>
                    <div className="erp-calendar-week-column-body">
                      {column.events.map((event) => (
                        <div
                          key={`${event.session.id}-${event.startMinutes}`}
                          className={`erp-calendar-event erp-calendar-week-event ${SESSION_CLASSNAMES[event.session.estado]}`}
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
                          onMouseEnter={(evt) =>
                            setTooltip({ session: event.session, rect: evt.currentTarget.getBoundingClientRect() })
                          }
                          onMouseLeave={() => setTooltip(null)}
                          onFocus={(evt) =>
                            setTooltip({ session: event.session, rect: evt.currentTarget.getBoundingClientRect() })
                          }
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
            <div
              className="erp-calendar-tooltip-overlay"
              style={{
                top: `${tooltip.rect.top + window.scrollY + tooltip.rect.height + 8}px`,
                left: `${tooltip.rect.left + window.scrollX + tooltip.rect.width / 2}px`,
              }}
            >
              <div className="erp-calendar-tooltip-content">
                <div className="erp-calendar-tooltip-title">{tooltip.session.title}</div>
                <div className="erp-calendar-tooltip-row">
                  <span className="erp-calendar-tooltip-label">Inicio</span>
                  <span className="erp-calendar-tooltip-value">
                    {madridDateFormatter.format(new Date(tooltip.session.start))} ·{' '}
                    {madridTimeFormatter.format(new Date(tooltip.session.start))}
                  </span>
                </div>
                <div className="erp-calendar-tooltip-row">
                  <span className="erp-calendar-tooltip-label">Fin</span>
                  <span className="erp-calendar-tooltip-value">
                    {madridDateFormatter.format(new Date(tooltip.session.end))} ·{' '}
                    {madridTimeFormatter.format(new Date(tooltip.session.end))}
                  </span>
                </div>
                {tooltip.session.room ? (
                  <div className="erp-calendar-tooltip-row">
                    <span className="erp-calendar-tooltip-label">Sala</span>
                    <span className="erp-calendar-tooltip-value">{tooltip.session.room.name}</span>
                  </div>
                ) : null}
                {tooltip.session.trainers.length ? (
                  <div className="erp-calendar-tooltip-row">
                    <span className="erp-calendar-tooltip-label">Formador/es</span>
                    <span className="erp-calendar-tooltip-value">
                      {tooltip.session.trainers
                        .map((trainer) =>
                          trainer.secondary ? `${trainer.name} ${trainer.secondary}`.trim() : trainer.name,
                        )
                        .join(', ')}
                    </span>
                  </div>
                ) : null}
                {tooltip.session.units.length ? (
                  <div className="erp-calendar-tooltip-row">
                    <span className="erp-calendar-tooltip-label">Unidades</span>
                    <span className="erp-calendar-tooltip-value">
                      {tooltip.session.units
                        .map((unit) => (unit.secondary ? `${unit.name} ${unit.secondary}`.trim() : unit.name))
                        .join(', ')}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
