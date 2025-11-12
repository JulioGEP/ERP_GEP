// frontend/src/features/calendar/CalendarView.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, Spinner } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import {
  fetchCalendarSessions,
  fetchCalendarVariants,
  type CalendarResource,
  type CalendarSession,
  type CalendarSessionsResponse,
  type CalendarVariantEvent,
  type CalendarVariantsResponse,
} from './api';
import type { SessionEstado } from '../../api/sessions.types';
import { ApiError } from '../../api/client';
import { FilterToolbar, type FilterDefinition, type FilterOption } from '../../components/table/FilterToolbar';
import { splitFilterValue } from '../../components/table/filterUtils';
import { useTableFilterState } from '../../hooks/useTableFilterState';
import { fetchProducts } from '../recursos/products.api';

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

// --- Helpers numéricos ---
const toNumberOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

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

const SESSION_ESTADO_OPTIONS = Object.entries(SESSION_ESTADO_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const CALENDAR_FILTER_DEFINITIONS: FilterDefinition[] = [
  { key: 'deal_id', label: 'Presupuesto' },
  { key: 'deal_title', label: 'Título del Presupuesto' },
  { key: 'deal_organization_name', label: 'Empresa' },
  { key: 'deal_pipeline_id', label: 'Negocio' },
  { key: 'deal_training_address', label: 'Dirección de formación' },
  { key: 'deal_sede_label', label: 'Sede' },
  { key: 'deal_caes_label', label: 'CAES' },
  { key: 'deal_fundae_label', label: 'FUNDAE' },
  { key: 'deal_hotel_label', label: 'Hotel' },
  { key: 'deal_transporte', label: 'Transporte' },
  { key: 'product_name', label: 'Producto' },
  { key: 'estado', label: 'Estado', type: 'select', options: SESSION_ESTADO_OPTIONS },
  {
    key: 'por_finalizar',
    label: 'Por finalizar',
    type: 'select',
    options: [
      { value: 'Sí', label: 'Sí' },
      { value: 'No', label: 'No' },
    ],
  },
  { key: 'trainer', label: 'Formador' },
  { key: 'unit', label: 'Unidad móvil' },
  { key: 'room', label: 'Sala' },
  { key: 'students_total', label: 'Alumnos' },
  { key: 'comentarios', label: 'Comentarios' },
];

const CALENDAR_SELECT_FILTER_KEYS = new Set<string>([
  'deal_pipeline_id',
  'deal_sede_label',
  'deal_caes_label',
  'deal_fundae_label',
  'deal_hotel_label',
  'deal_transporte',
  'product_name',
  'estado',
  'trainer',
  'unit',
  'room',
]);

const CALENDAR_DYNAMIC_SELECT_KEYS = new Set<string>(
  Array.from(CALENDAR_SELECT_FILTER_KEYS).filter(
    (key) => key !== 'product_name' && key !== 'estado',
  ),
);

const CALENDAR_FILTER_KEYS = CALENDAR_FILTER_DEFINITIONS.map((definition) => definition.key);

type CalendarViewType = 'month' | 'week' | 'day';
type CalendarMode = 'sessions' | 'trainers' | 'units';

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type CalendarViewProps = {
  onNotify?: (toast: ToastParams) => void;
  onSessionOpen?: (session: CalendarSession) => void;
  onVariantOpen?: (variant: CalendarVariantEvent) => void;
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

type TooltipLine = { left: string | null; right: string | null; separator?: string };

type CalendarEventItem =
  | { kind: 'session'; start: string; end: string; session: CalendarSession }
  | { kind: 'variant'; start: string; end: string; variant: CalendarVariantEvent };

type MonthDayCell = {
  julian: number;
  date: MadridDate;
  iso: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEventItem[];
};

type BaseDayEvent = {
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

type DayEvent =
  | (BaseDayEvent & { kind: 'session'; session: CalendarSession })
  | (BaseDayEvent & { kind: 'variant'; variant: CalendarVariantEvent });

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

type CalendarFilterRow = {
  id: string;
  type: 'session' | 'variant';
  normalized: Record<string, string>;
  search: string;
};

function safeString(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length ? text : '';
}

function collectVariantDealValues(
  variant: CalendarVariantEvent,
  extractor: (deal: CalendarVariantEvent['deals'][number]) => string | null | undefined,
): string[] {
  if (!Array.isArray(variant.deals) || !variant.deals.length) {
    return [];
  }
  const seen = new Set<string>();
  const values: string[] = [];
  variant.deals.forEach((deal) => {
    const value = safeString(extractor(deal));
    if (!value.length) {
      return;
    }
    const key = value.toLocaleLowerCase('es-ES');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    values.push(value);
  });
  return values;
}

function joinVariantDealValues(
  variant: CalendarVariantEvent,
  extractor: (deal: CalendarVariantEvent['deals'][number]) => string | null | undefined,
): string {
  return collectVariantDealValues(variant, extractor).join(' ');
}

function normalizeText(value: string): string {
  if (!value.length) return '';
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function formatStudentsFilterValue(count: number | null | undefined): string {
  if (typeof count === 'number' && Number.isFinite(count)) {
    if (count <= 0) {
      return '0 sin alumnos';
    }
    const suffix = count === 1 ? ' alumno' : ' alumnos';
    return `${count}${suffix}`;
  }
  return 'sin alumnos';
}

function isSessionPendingCompletion(session: CalendarSession): boolean {
  if (session.estado === 'FINALIZADA') {
    return false;
  }

  try {
    const endDate = new Date(session.end);
    if (Number.isNaN(endDate.getTime())) {
      return false;
    }
    return endDate.getTime() < Date.now();
  } catch {
    return false;
  }
}

const CALENDAR_SESSION_FILTER_ACCESSORS: Record<string, (session: CalendarSession) => string> = {
  deal_id: (session) => safeString(session.dealId),
  deal_title: (session) => safeString(session.dealTitle ?? ''),
  deal_organization_name: (session) =>
    safeString(session.dealOrganizationName ?? session.dealTitle ?? ''),
  deal_pipeline_id: (session) => safeString(session.dealPipelineId ?? ''),
  deal_training_address: (session) => safeString(session.dealAddress ?? session.direccion ?? ''),
  deal_sede_label: (session) => safeString(session.dealSedeLabel ?? ''),
  deal_caes_label: (session) => safeString(session.dealCaesLabel ?? ''),
  deal_fundae_label: (session) => safeString(session.dealFundaeLabel ?? ''),
  deal_hotel_label: (session) => safeString(session.dealHotelLabel ?? ''),
  deal_transporte: (session) => safeString(session.dealTransporte ?? ''),
  product_name: (session) => safeString(session.productName ?? ''),
  estado: (session) =>
    safeString(`${session.estado} ${SESSION_ESTADO_LABELS[session.estado] ?? session.estado}`),
  trainer: (session) => safeString(session.trainers.map((trainer) => formatResourceName(trainer)).join(' ')),
  unit: (session) => safeString(session.units.map((unit) => formatResourceName(unit)).join(' ')),
  room: (session) => (session.room ? safeString(formatResourceName(session.room)) : ''),
  students_total: (session) => {
    const namePart = safeString(session.studentNames.join(' '));
    const countPart = formatStudentsFilterValue(session.studentsTotal);
    const parts = [] as string[];
    if (namePart.length) {
      parts.push(namePart);
    }
    if (countPart.length) {
      parts.push(countPart);
    }
    return safeString(parts.join(' '));
  },
  comentarios: (session) => safeString(session.comentarios ?? ''),
  por_finalizar: (session) => (isSessionPendingCompletion(session) ? 'Sí' : 'No'),
};

const CALENDAR_VARIANT_FILTER_ACCESSORS: Record<string, (variant: CalendarVariantEvent) => string> = {
  deal_id: (variant) => joinVariantDealValues(variant, (deal) => deal.id),
  deal_title: (variant) => joinVariantDealValues(variant, (deal) => deal.title),
  deal_organization_name: (variant) =>
    joinVariantDealValues(variant, (deal) => deal.organizationName ?? deal.title),
  deal_pipeline_id: (variant) => joinVariantDealValues(variant, (deal) => deal.pipelineId),
  deal_training_address: (variant) => {
    const values = [safeString(variant.variant.sede ?? '')]
      .concat(collectVariantDealValues(variant, (deal) => deal.trainingAddress))
      .filter((value) => value.length);
    return values.join(' ');
  },
  deal_sede_label: (variant) => {
    const values = [safeString(variant.variant.sede ?? '')]
      .concat(collectVariantDealValues(variant, (deal) => deal.sedeLabel))
      .filter((value) => value.length);
    return values.join(' ');
  },
  deal_caes_label: (variant) => joinVariantDealValues(variant, (deal) => deal.caesLabel),
  deal_fundae_label: (variant) => joinVariantDealValues(variant, (deal) => deal.fundaeLabel),
  deal_hotel_label: (variant) => joinVariantDealValues(variant, (deal) => deal.hotelLabel),
  deal_transporte: (variant) => joinVariantDealValues(variant, (deal) => deal.transporte),
  product_name: (variant) => safeString(variant.variant.name ?? variant.product.name ?? ''),
  estado: (variant) => {
    const status = safeString(variant.variant.status ?? '');
    if (!status.length) return '';
    const normalized = status.toLowerCase();
    if (normalized === 'publish') return 'publish publicado';
    if (normalized === 'private') return 'private cancelada';
    return status;
  },
  trainer: (variant) => safeString(formatVariantTrainerNames(getVariantTrainerResources(variant))),
  unit: (variant) => {
    const units =
      variant.variant.unidades && variant.variant.unidades.length
        ? variant.variant.unidades
        : variant.variant.unidad
        ? [variant.variant.unidad]
        : [];
    if (!units.length) return '';
    const labels = units
      .map((unit) =>
        [safeString(unit.name ?? ''), safeString(unit.matricula ?? '')]
          .filter(Boolean)
          .join(' ')
          .trim(),
      )
      .filter((label) => label.length);
    return safeString(labels.join(' '));
  },
  room: (variant) => {
    const room = variant.variant.sala;
    if (!room) return '';
    const parts = [safeString(room.name ?? ''), safeString(room.sede ?? '')].filter(Boolean);
    return safeString(parts.join(' '));
  },
  students_total: (variant) => safeString(formatStudentsFilterValue(variant.variant.students_total)),
  comentarios: (variant) => safeString(variant.variant.status ?? ''),
  por_finalizar: () => '',
};

type VariantTrainer = CalendarVariantEvent['variant']['trainers'][number];
type VariantUnit = CalendarVariantEvent['variant']['unidades'][number];

function getVariantTrainerResources(variant: CalendarVariantEvent): VariantTrainer[] {
  if (variant.variant.trainers && variant.variant.trainers.length) {
    return variant.variant.trainers;
  }
  if (variant.variant.trainer) {
    return [variant.variant.trainer];
  }
  return [];
}

function formatVariantTrainerNames(trainers: VariantTrainer[]): string {
  return trainers
    .map((trainer) =>
      [trainer.name?.trim() ?? '', trainer.apellido?.trim() ?? '']
        .filter((value) => value.length)
        .join(' ') // combine nombre and apellido
        .trim(),
    )
    .filter((value) => value.length)
    .join(', ');
}

function getVariantUnitResources(variant: CalendarVariantEvent): VariantUnit[] {
  if (variant.variant.unidades && variant.variant.unidades.length) {
    return variant.variant.unidades;
  }
  if (variant.variant.unidad) {
    return [variant.variant.unidad];
  }
  return [];
}

function formatVariantUnitNames(units: VariantUnit[]): string {
  return units
    .map((unit) => {
      const name = unit.name?.trim() ?? '';
      const plate = unit.matricula?.trim() ?? '';
      if (name && plate) {
        return `${name} (${plate})`;
      }
      if (name) {
        return name;
      }
      if (plate) {
        return plate;
      }
      return '';
    })
    .filter((value) => value.length)
    .join(', ');
}

function subsequenceScore(text: string, token: string): number {
  if (!token.length) return Number.POSITIVE_INFINITY;
  let score = 0;
  let position = 0;
  for (const char of token) {
    const index = text.indexOf(char, position);
    if (index === -1) {
      return Number.POSITIVE_INFINITY;
    }
    score += index - position;
    position = index + 1;
  }
  return score;
}

function computeFuzzyScore(text: string, query: string): number {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const token of tokens) {
    const score = subsequenceScore(text, token);
    if (!Number.isFinite(score)) {
      return Number.POSITIVE_INFINITY;
    }
    total += score;
  }
  return total;
}

function createSessionFilterRow(session: CalendarSession): CalendarFilterRow {
  const normalized: Record<string, string> = {};
  for (const key of CALENDAR_FILTER_KEYS) {
    const accessor = CALENDAR_SESSION_FILTER_ACCESSORS[key];
    const raw = accessor ? accessor(session) : '';
    normalized[key] = normalizeText(raw);
  }
  const searchParts = [
    ...CALENDAR_FILTER_KEYS.map((key) => normalized[key] ?? ''),
    normalizeText(safeString(session.title)),
    normalizeText(SESSION_ESTADO_LABELS[session.estado] ?? ''),
  ];
  return {
    id: session.id,
    type: 'session',
    normalized,
    search: searchParts.filter(Boolean).join(' '),
  };
}

function createVariantFilterRow(variant: CalendarVariantEvent): CalendarFilterRow {
  const normalized: Record<string, string> = {};
  for (const key of CALENDAR_FILTER_KEYS) {
    const accessor = CALENDAR_VARIANT_FILTER_ACCESSORS[key];
    const raw = accessor ? accessor(variant) : '';
    normalized[key] = normalizeText(raw);
  }
  const searchParts = [
    ...CALENDAR_FILTER_KEYS.map((key) => normalized[key] ?? ''),
    normalizeText(safeString(variant.variant.name ?? '')),
    normalizeText(safeString(variant.product.name ?? '')),
    normalizeText(safeString(variant.variant.status ?? '')),
  ];
  return {
    id: variant.id,
    type: 'variant',
    normalized,
    search: searchParts.filter(Boolean).join(' '),
  };
}

function applyCalendarFilters(
  rows: CalendarFilterRow[],
  filters: Record<string, string>,
  search: string,
): CalendarFilterRow[] {
  const filterEntries = Object.entries(filters).filter(([, value]) => value.trim().length);
  let filtered = rows;
  if (filterEntries.length) {
    filtered = filtered.filter((row) =>
      filterEntries.every(([key, value]) => {
        const parts = splitFilterValue(value);
        if (parts.length > 1) {
          return parts.some((part) => {
            const normalizedPart = normalizeText(safeString(part));
            if (!normalizedPart.length) return false;
            const targetValue = row.normalized[key] ?? '';
            return targetValue.includes(normalizedPart);
          });
        }
        const normalizedValue = normalizeText(safeString(value));
        if (!normalizedValue.length) return true;
        const target = row.normalized[key] ?? '';
        return target.includes(normalizedValue);
      }),
    );
  }

  const normalizedSearch = normalizeText(safeString(search));
  if (!normalizedSearch.length) {
    return filtered;
  }

  const scored = filtered
    .map((row) => ({ row, score: computeFuzzyScore(row.search, normalizedSearch) }))
    .filter((item) => Number.isFinite(item.score));

  scored.sort((a, b) => a.score - b.score);
  return scored.map((item) => item.row);
}

function groupEventsByJulian(events: CalendarEventItem[]): Map<number, CalendarEventItem[]> {
  const map = new Map<number, CalendarEventItem[]>();
  events.forEach((event) => {
    const start = getMadridDateTime(new Date(event.start));
    const end = getMadridDateTime(new Date(event.end));
    let startJulian = getJulianDay(start);
    let endJulian = getJulianDay(end);
    if (endJulian > startJulian && end.hour === 0 && end.minute === 0) {
      endJulian -= 1;
    }
    for (let jd = startJulian; jd <= endJulian; jd += 1) {
      const list = map.get(jd) ?? [];
      list.push(event);
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

function buildWeekColumns(range: VisibleRange, events: CalendarEventItem[]): WeekColumn[] {
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

  const filtered = events.filter((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    return end > weekStartUTC && start < weekEndUTC;
  });

  columns.forEach((column) => {
    const dayStart = madridDateToUTC(column.date);
    const dayEnd = madridDateToUTC(julianToMadridDate(column.julian + 1));
    const dayEvents: DayEvent[] = [];

    filtered.forEach((item) => {
      const start = new Date(item.start);
      const end = new Date(item.end);
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
      const baseEvent: BaseDayEvent = {
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
      };
      if (item.kind === 'session') {
        dayEvents.push({ ...baseEvent, kind: 'session', session: item.session });
      } else {
        dayEvents.push({ ...baseEvent, kind: 'variant', variant: item.variant });
      }
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
  onVariantOpen,
  title = 'Calendario',
  mode = 'sessions',
  initialView = 'month',
}: CalendarViewProps) {
  const storageKey = `${STORAGE_KEY_PREFIX}-${mode}`;
  const stored = useMemo(() => readStoredPreferences(storageKey, initialView), [storageKey, initialView]);
  const [view, setView] = useState<CalendarViewType>(stored.view);
  const [currentDate, setCurrentDate] = useState<Date>(stored.date);
  const [visibleRange, setVisibleRange] = useState<VisibleRange>(() => computeVisibleRange(stored.view, stored.date));
  const userPreferredViewRef = useRef<CalendarViewType>(stored.view);
  const autoFocusSessionIdRef = useRef<string | null>(null);
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

  const includeVariants = mode === 'sessions' || mode === 'trainers' || mode === 'units';

  const sessionsQuery = useQuery<CalendarSessionsResponse, ApiError>({
    queryKey: ['calendarSessions', fetchRange?.start ?? null, fetchRange?.end ?? null],
    queryFn: () => fetchCalendarSessions({ start: fetchRange!.start, end: fetchRange!.end }),
    enabled: !!fetchRange,
    staleTime: 5 * 60 * 1000,
  });

  const variantsQuery = useQuery<CalendarVariantsResponse, ApiError>({
    queryKey: ['calendarVariants', fetchRange?.start ?? null, fetchRange?.end ?? null],
    queryFn: () => fetchCalendarVariants({ start: fetchRange!.start, end: fetchRange!.end }),
    enabled: includeVariants && !!fetchRange,
    staleTime: 5 * 60 * 1000,
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const rawVariants = includeVariants ? variantsQuery.data?.variants ?? [] : [];

  const variants = useMemo(() => {
    if (!includeVariants) {
      return [];
    }
    if (mode !== 'trainers') {
      return rawVariants;
    }
    return rawVariants.filter((variant) => getVariantTrainerResources(variant).length > 0);
  }, [includeVariants, mode, rawVariants]);

  const productOptionsQuery = useQuery({
    queryKey: ['calendar-filter-products'],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000,
  });

  const productFilterOptions = useMemo<FilterOption[]>(() => {
    const products = productOptionsQuery.data ?? [];
    if (!products.length) {
      return [];
    }

    const seen = new Set<string>();
    const options: FilterOption[] = [];

    products.forEach((product) => {
      const name = typeof product?.name === 'string' ? product.name.trim() : '';
      const code = typeof product?.code === 'string' ? product.code.trim() : '';
      const value = name.length ? name : code;
      if (!value.length) {
        return;
      }
      const normalized = value.toLocaleLowerCase('es-ES');
      if (seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      const label = name.length && code.length && code !== name ? `${name} (${code})` : value;
      options.push({ value, label });
    });

    options.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    return options;
  }, [productOptionsQuery.data]);

  const selectOptionsByKey = useMemo(() => {
    const accumulator = new Map<string, Set<string>>();
    CALENDAR_DYNAMIC_SELECT_KEYS.forEach((key) => {
      accumulator.set(key, new Set<string>());
    });

    const addValue = (key: string, value: string | null | undefined) => {
      if (!CALENDAR_DYNAMIC_SELECT_KEYS.has(key)) {
        return;
      }
      const trimmed = safeString(value ?? '');
      if (!trimmed.length) {
        return;
      }
      accumulator.get(key)?.add(trimmed);
    };

    sessions.forEach((session) => {
      addValue('deal_pipeline_id', session.dealPipelineId);
      addValue('deal_sede_label', session.dealSedeLabel);
      addValue('deal_caes_label', session.dealCaesLabel);
      addValue('deal_fundae_label', session.dealFundaeLabel);
      addValue('deal_hotel_label', session.dealHotelLabel);
      addValue('deal_transporte', session.dealTransporte);
      session.trainers.forEach((trainer) => addValue('trainer', formatResourceName(trainer)));
      session.units.forEach((unit) => addValue('unit', formatResourceName(unit)));
      if (session.room) {
        addValue('room', formatResourceName(session.room));
      }
    });

    if (includeVariants) {
      variants.forEach((variant) => {
        addValue('deal_training_address', variant.variant.sede ?? '');
        addValue('deal_sede_label', variant.variant.sede ?? '');

        variant.deals.forEach((deal) => {
          addValue('deal_pipeline_id', deal.pipelineId);
          addValue('deal_training_address', deal.trainingAddress);
          addValue('deal_sede_label', deal.sedeLabel);
          addValue('deal_caes_label', deal.caesLabel);
          addValue('deal_fundae_label', deal.fundaeLabel);
          addValue('deal_hotel_label', deal.hotelLabel);
          addValue('deal_transporte', deal.transporte);
        });

        const trainers = getVariantTrainerResources(variant);
        trainers.forEach((trainer) => {
          const label = formatVariantTrainerNames([trainer]);
          if (label.trim().length) {
            addValue('trainer', label);
          }
        });

        const units =
          variant.variant.unidades && variant.variant.unidades.length
            ? variant.variant.unidades
            : variant.variant.unidad
            ? [variant.variant.unidad]
            : [];
        units.forEach((unit) => {
          const parts = [safeString(unit.name ?? ''), safeString(unit.matricula ?? '')].filter(Boolean);
          const label = parts.join(' ');
          if (label.trim().length) {
            addValue('unit', label);
          }
        });

        const room = variant.variant.sala;
        if (room) {
          const parts = [safeString(room.name ?? ''), safeString(room.sede ?? '')].filter(Boolean);
          addValue('room', parts.join(' '));
        }
      });
    }

    const result: Record<string, FilterOption[]> = {};
    CALENDAR_DYNAMIC_SELECT_KEYS.forEach((key) => {
      const values = accumulator.get(key);
      if (!values || !values.size) {
        result[key] = [];
        return;
      }
      const sorted = Array.from(values).sort((a, b) =>
        a.localeCompare(b, 'es', { sensitivity: 'base' }),
      );
      result[key] = sorted.map((value) => ({ value, label: value }));
    });

    return result;
  }, [sessions, variants, includeVariants]);

  const calendarFilterDefinitions = useMemo<FilterDefinition[]>(
    () =>
      CALENDAR_FILTER_DEFINITIONS.map((definition) => {
        if (definition.key === 'product_name') {
          return {
            ...definition,
            type: 'select',
            options: productFilterOptions,
            placeholder: definition.placeholder ?? 'Selecciona un producto',
          } satisfies FilterDefinition;
        }

        if (definition.key === 'estado') {
          return {
            ...definition,
            placeholder: definition.placeholder ?? 'Selecciona un estado',
          } satisfies FilterDefinition;
        }

        if (CALENDAR_DYNAMIC_SELECT_KEYS.has(definition.key)) {
          const options = selectOptionsByKey[definition.key] ?? [];
          return {
            ...definition,
            type: 'select',
            options,
            placeholder: definition.placeholder ?? 'Selecciona una opción',
          } satisfies FilterDefinition;
        }

        return definition;
      }),
    [productFilterOptions, selectOptionsByKey],
  );

  const {
    filters: activeFilters,
    searchValue,
    setSearchValue,
    setFiltersAndSearch,
    setFilterValue,
    clearFilter,
    clearAllFilters,
  } = useTableFilterState({ tableKey: `calendar-${mode}` });

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const trimmed = value.trim();
      setFilterValue(key, trimmed.length ? trimmed : null);
    },
    [setFilterValue],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
    },
    [setSearchValue],
  );

  const sessionFilterRows = useMemo(
    () => sessions.map((session) => createSessionFilterRow(session)),
    [sessions],
  );

  const variantFilterRows = useMemo(
    () => (includeVariants ? variants.map((variant) => createVariantFilterRow(variant)) : []),
    [variants, includeVariants],
  );

  const filteredSessionRows = useMemo(
    () => applyCalendarFilters(sessionFilterRows, activeFilters, searchValue),
    [sessionFilterRows, activeFilters, searchValue],
  );

  const filteredVariantRows = useMemo(
    () => applyCalendarFilters(variantFilterRows, activeFilters, searchValue),
    [variantFilterRows, activeFilters, searchValue],
  );

  const filteredSessionIds = useMemo(
    () => new Set(filteredSessionRows.map((row) => row.id)),
    [filteredSessionRows],
  );

  const filteredVariantIds = useMemo(
    () => new Set(filteredVariantRows.map((row) => row.id)),
    [filteredVariantRows],
  );

  const filteredSessions = useMemo(
    () => sessions.filter((session) => filteredSessionIds.has(session.id)),
    [sessions, filteredSessionIds],
  );

  const filteredVariants = useMemo(
    () => (includeVariants ? variants.filter((variant) => filteredVariantIds.has(variant.id)) : []),
    [variants, filteredVariantIds, includeVariants],
  );

  const resultCount = filteredSessions.length + (includeVariants ? filteredVariants.length : 0);

  useEffect(() => {
    const hasFilter = Object.keys(activeFilters).length > 0;
    const hasSearch = searchValue.trim().length > 0;
    if ((hasFilter || hasSearch) && resultCount === 1) {
      const session = filteredSessions[0];
      if (session) {
        const sessionId = session.id;
        if (autoFocusSessionIdRef.current !== sessionId) {
          autoFocusSessionIdRef.current = sessionId;
          const targetDate = new Date(session.start);
          if (!Number.isNaN(targetDate.getTime())) {
            setCurrentDate(targetDate);
          }
          if (view !== 'day') {
            setView('day');
          }
        }
        return;
      }
    }

    if (autoFocusSessionIdRef.current) {
      autoFocusSessionIdRef.current = null;
      const preferred = userPreferredViewRef.current;
      if (view !== preferred) {
        setView(preferred);
      }
    }
  }, [activeFilters, filteredSessions, resultCount, searchValue, view]);

  const events: CalendarEventItem[] = useMemo(() => {
    const items: CalendarEventItem[] = filteredSessions.map((session) => ({
      kind: 'session',
      start: session.start,
      end: session.end,
      session,
    }));
    if (includeVariants) {
      filteredVariants.forEach((variant) => {
        items.push({
          kind: 'variant',
          start: variant.start,
          end: variant.end,
          variant,
        });
      });
    }
    return items;
  }, [filteredSessions, filteredVariants, includeVariants]);

  const eventGroups = useMemo(() => groupEventsByJulian(events), [events]);

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
        events: [...(eventGroups.get(jd) ?? [])].sort((a, b) => a.start.localeCompare(b.start)),
      });
    }
    return days;
  }, [view, visibleRange, currentDate, eventGroups]);

  const weekColumns = useMemo(() => {
    if (view === 'month') return null;
    return buildWeekColumns(visibleRange, events);
  }, [view, visibleRange, events]);

  const isInitialLoading =
    (sessionsQuery.isLoading && !sessionsQuery.data) ||
    (includeVariants && variantsQuery.isLoading && !variantsQuery.data);
  const isFetching = sessionsQuery.isFetching || (includeVariants && variantsQuery.isFetching);
  const error =
    (sessionsQuery.error as ApiError | null) ??
    (includeVariants ? (variantsQuery.error as ApiError | null) : null);

  const handleRefetch = useCallback(() => {
    void sessionsQuery.refetch();
    if (includeVariants) {
      void variantsQuery.refetch();
    }
  }, [sessionsQuery, variantsQuery, includeVariants]);

  const handleViewChange = useCallback((nextView: CalendarViewType) => {
    userPreferredViewRef.current = nextView;
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
        kind: 'session';
        session: CalendarSession;
        rect: DOMRect;
        pointer?: { x: number; y: number };
      }
    | {
        kind: 'variant';
        variant: CalendarVariantEvent;
        rect: DOMRect;
        pointer?: { x: number; y: number };
      }
    | null
  >(null);

  const tooltipStartLabel = tooltip
    ? madridTimeFormatter.format(
        new Date(tooltip.kind === 'session' ? tooltip.session.start : tooltip.variant.start),
      )
    : '';
  const tooltipEndLabel = tooltip
    ? madridTimeFormatter.format(
        new Date(tooltip.kind === 'session' ? tooltip.session.end : tooltip.variant.end),
      )
    : '';
  const tooltipDateLabel = tooltip
    ? madridDateFormatter.format(
        new Date(tooltip.kind === 'session' ? tooltip.session.start : tooltip.variant.start),
      )
    : '';

  const tooltipTitle = tooltip
    ? tooltip.kind === 'session'
      ? tooltip.session.title
      : (() => {
          const productName = (tooltip.variant.product.name ?? '').trim();
          if (productName.length) {
            return productName;
          }
          const productCode = (tooltip.variant.product.code ?? '').trim();
          if (productCode.length) {
            return productCode;
          }
          return 'Producto sin nombre';
        })()
    : '';

  const tooltipSecondaryLine = (() => {
    if (!tooltip) {
      return { left: null, right: null } satisfies TooltipLine;
    }
    if (tooltip.kind === 'session') {
      const organizationLabel =
        tooltip.session.dealOrganizationName?.trim() || tooltip.session.dealTitle?.trim() || '';
      return {
        left: organizationLabel.length ? organizationLabel : 'Sin empresa',
        right: tooltip.session.dealAddress?.trim() || tooltip.session.direccion?.trim() || 'Sin dirección',
        separator: ' - ',
      } satisfies TooltipLine;
    }
    const studentsRaw = tooltip.variant.variant.students_total;
    const studentsLabel =
      typeof studentsRaw === 'number' && Number.isFinite(studentsRaw)
        ? String(studentsRaw)
        : 'No disponible';

    const sedeRaw = tooltip.variant.variant.sede;
    const sedeLabel = typeof sedeRaw === 'string' && sedeRaw.trim().length ? sedeRaw.trim() : 'Sin asignar';
    return {
      left: `Sede: ${sedeLabel}`,
      right: `Alumnos totales: ${studentsLabel}`,
      separator: ' - ',
    } satisfies TooltipLine;
  })();

  const tooltipTertiaryLine = (() => {
    if (!tooltip) {
      return { left: null, right: null } satisfies TooltipLine;
    }
    if (tooltip.kind === 'session') {
      const trainersLabel =
        tooltip.session.trainers.length
          ? tooltip.session.trainers
              .map((trainer) =>
                trainer.secondary ? `${trainer.name} ${trainer.secondary}`.trim() : trainer.name,
              )
              .join(', ')
          : 'Sin formador';
      const unitsLabel =
        tooltip.session.units.length
          ? tooltip.session.units
              .map((unit) => (unit.secondary ? `${unit.name} ${unit.secondary}`.trim() : unit.name))
              .join(', ')
          : 'Sin unidad móvil';
      return { left: trainersLabel, right: unitsLabel, separator: ' - ' } satisfies TooltipLine;
    }

    const trainers = getVariantTrainerResources(tooltip.variant);
    const trainerNames = formatVariantTrainerNames(trainers);
    const trainerLabel = trainerNames.length ? `Formador: ${trainerNames}` : 'Formador: Sin asignar';

    const units =
      tooltip.variant.variant.unidades && tooltip.variant.variant.unidades.length
        ? tooltip.variant.variant.unidades
        : tooltip.variant.variant.unidad
        ? [tooltip.variant.variant.unidad]
        : [];
    const unitLabel = units.length
      ? `Unidad móvil: ${units
          .map((unit) => {
            const unitName = unit.name?.trim() ?? '';
            const unitPlate = unit.matricula?.trim() ?? '';
            if (unitName && unitPlate) {
              return `${unitName} (${unitPlate})`;
            }
            if (unitName) {
              return unitName;
            }
            if (unitPlate) {
              return unitPlate;
            }
            return '';
          })
          .filter((value) => value.length)
          .join(', ')}`
      : 'Unidad móvil: Sin asignar';

    return { left: trainerLabel, right: unitLabel, separator: ' - ' } satisfies TooltipLine;
  })();

  const renderTooltipLine = (line: TooltipLine): string => {
    const left = line.left?.toString().trim();
    const right = line.right?.toString().trim();
    const separator = line.separator ?? ' - ';

    if (left && right) {
      return `${left}${separator}${right}`;
    }
    if (left) {
      return left;
    }
    if (right) {
      return right;
    }
    return '';
  };

  const tooltipSecondaryText = renderTooltipLine(tooltipSecondaryLine);
  const tooltipTertiaryText = renderTooltipLine(tooltipTertiaryLine);

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

  const renderEventContent = (item: CalendarEventItem | DayEvent) => {
    if (item.kind === 'session') {
      const session = item.session;
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
    }

    const variantEvent = item.variant;
    const chips: string[] = [];
    if (variantEvent.product.name) {
      chips.push(`Producto: ${variantEvent.product.name}`);
    } else if (variantEvent.product.code) {
      chips.push(`Producto: ${variantEvent.product.code}`);
    }
    if (variantEvent.variant.sede) {
      chips.push(`Sede: ${variantEvent.variant.sede}`);
    }
    const trainerResources = getVariantTrainerResources(variantEvent);
    const trainerNames = formatVariantTrainerNames(trainerResources);
    const unitResources = getVariantUnitResources(variantEvent);
    const unitNames = formatVariantUnitNames(unitResources);
    const trainerLabel = trainerNames.length ? `Formador: ${trainerNames}` : 'Formador: Sin asignar';
    chips.push(trainerLabel);
    if (variantEvent.variant.stock != null) {
      chips.push(`Stock: ${variantEvent.variant.stock}`);
    }

    const eventTitle =
      mode === 'trainers'
        ? trainerNames.length
          ? trainerNames
          : 'Sin formador'
        : mode === 'units'
        ? unitNames.length
          ? unitNames
          : 'Sin unidad móvil'
        : variantEvent.variant.name?.trim().length
        ? variantEvent.variant.name
        : variantEvent.product.name ?? 'Variante sin nombre';

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
        <span
          className={`erp-calendar-event-status ${
            variantEvent.variant.status
              ? `erp-calendar-event-status--${variantEvent.variant.status.toLowerCase()}`
              : ''
          }`.trim()}
        >
          {(() => {
            const status = variantEvent.variant.status?.toLowerCase();
            if (status === 'publish') {
              return 'Publicado';
            }
            if (status === 'private') {
              return 'Cancelada';
            }
            return variantEvent.variant.status ?? 'Variante';
          })()}
        </span>
      </div>
    );
  };

  const isDayView = view === 'day';

  return (
    <section className="d-grid gap-4">
      <header className="d-grid gap-3">
        <div className="d-flex flex-column flex-xl-row align-items-xl-start justify-content-between gap-3">
          <div className="d-flex flex-column gap-2 flex-grow-1">
            <div className="d-flex flex-wrap align-items-center gap-3">
              <h1 className="h3 fw-bold mb-0">{title}</h1>
              <div className="flex-grow-1" style={{ minWidth: '240px' }}>
                <FilterToolbar
                  filters={calendarFilterDefinitions}
                  activeFilters={activeFilters}
                  searchValue={searchValue}
                  onSearchChange={handleSearchChange}
                  onFilterChange={handleFilterChange}
                  onRemoveFilter={clearFilter}
                  onClearAll={clearAllFilters}
                  resultCount={resultCount}
                  isServerBusy={isFetching}
                  viewStorageKey={`calendar-${mode}`}
                  onApplyFilterState={({ filters, searchValue }) =>
                    setFiltersAndSearch(filters, searchValue)
                  }
                />
              </div>
            </div>
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2 justify-content-xl-end">
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
        </div>
      </header>

      {error ? (
        <Alert variant="danger" className="mb-0">
          <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
            <div>
              <strong className="d-block mb-1">No se pudo cargar el calendario</strong>
              <span className="small">{error.message}</span>
            </div>
            <Button size="sm" variant="outline-danger" onClick={handleRefetch}>
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
                      {day.events.map((eventItem) => {
                        if (eventItem.kind === 'session') {
                          const session = eventItem.session;
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
                              key={`session-${session.id}`}
                              className={`erp-calendar-event erp-calendar-month-event ${SESSION_CLASSNAMES[session.estado]}`}
                              role="button"
                              tabIndex={0}
                              draggable
                              title={monthEventTitle}
                              onClick={() => onSessionOpen?.(session)}
                              onKeyDown={(keyboardEvent) => {
                                if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                                  keyboardEvent.preventDefault();
                                  onSessionOpen?.(session);
                                }
                              }}
                              onDragEnd={handleEventDragEnd}
                              onMouseEnter={(mouseEvent) => {
                                const target = mouseEvent.currentTarget;
                                if (!target) return;
                                setTooltip({ kind: 'session', session, rect: target.getBoundingClientRect() });
                              }}
                              onMouseLeave={() => setTooltip(null)}
                              onFocus={(focusEvent) => {
                                const target = focusEvent.currentTarget;
                                if (!target) return;
                                setTooltip({ kind: 'session', session, rect: target.getBoundingClientRect() });
                              }}
                              onBlur={() => setTooltip(null)}
                            >
                              <span className="erp-calendar-month-event-dot" aria-hidden="true" />
                              <span className="erp-calendar-month-event-text">{monthEventLabel}</span>
                            </div>
                          );
                        }

                        const variant = eventItem.variant;
                        const trainerResources = getVariantTrainerResources(variant);
                        const trainerNames = formatVariantTrainerNames(trainerResources);
                        const unitResources = getVariantUnitResources(variant);
                        const unitNames = formatVariantUnitNames(unitResources);
                        const variantLabel =
                          mode === 'trainers'
                            ? trainerNames.length
                              ? trainerNames
                              : 'Sin formador'
                            : mode === 'units'
                            ? unitNames.length
                              ? unitNames
                              : 'Sin unidad móvil'
                            : variant.variant.name?.trim().length
                            ? variant.variant.name
                            : variant.product.name ?? 'Variante sin nombre';
                        const variantTitleParts: string[] = [];
                        if (variant.product.name) {
                          variantTitleParts.push(variant.product.name);
                        } else if (variant.product.code) {
                          variantTitleParts.push(variant.product.code);
                        }
                        if (variant.variant.sede) {
                          variantTitleParts.push(variant.variant.sede);
                        }
                        const variantTitle = variantTitleParts.length
                          ? variantTitleParts.join(' · ')
                          : variantLabel ?? 'Variante sin nombre';

                        return (
                          <div
                            key={`variant-${variant.id}`}
                            className="erp-calendar-event erp-calendar-month-event erp-calendar-event-variant"
                            title={variantTitle}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setTooltip(null);
                              onVariantOpen?.(variant);
                            }}
                            onKeyDown={(keyboardEvent) => {
                              if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                                keyboardEvent.preventDefault();
                                setTooltip(null);
                                onVariantOpen?.(variant);
                              }
                            }}
                            onMouseEnter={(mouseEvent) => {
                              const target = mouseEvent.currentTarget;
                              if (!target) return;
                              setTooltip({
                                kind: 'variant',
                                variant,
                                rect: target.getBoundingClientRect(),
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                            onFocus={(focusEvent) => {
                              const target = focusEvent.currentTarget;
                              if (!target) return;
                              setTooltip({
                                kind: 'variant',
                                variant,
                                rect: target.getBoundingClientRect(),
                              });
                            }}
                            onBlur={() => setTooltip(null)}
                          >
                            <span className="erp-calendar-month-event-dot" aria-hidden="true" />
                            <span className="erp-calendar-month-event-text">{variantLabel}</span>
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
                      {column.events.map((event) => {
                        const baseClass = 'erp-calendar-event erp-calendar-week-event';
                        const continuesClasses = `${
                          event.continuesFromPreviousDay ? 'is-continued-from-previous-day' : ''
                        } ${event.continuesIntoNextDay ? 'is-continued-into-next-day' : ''}`.trim();

                        if (event.kind === 'session') {
                          const className = `${baseClass} ${SESSION_CLASSNAMES[event.session.estado]} ${continuesClasses}`.trim();
                          return (
                            <div
                              key={`session-${event.session.id}-${event.startMinutes}`}
                              className={className}
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
                                  kind: 'session',
                                  session: event.session,
                                  rect: target.getBoundingClientRect(),
                                  pointer: { x: evt.clientX, y: evt.clientY },
                                });
                              }}
                              onMouseMove={(evt) => {
                                const target = evt.currentTarget;
                                if (!target) return;
                                setTooltip((current) =>
                                  current && current.kind === 'session' && current.session.id === event.session.id
                                    ? {
                                        kind: 'session',
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
                                setTooltip({
                                  kind: 'session',
                                  session: event.session,
                                  rect: target.getBoundingClientRect(),
                                });
                              }}
                              onBlur={() => setTooltip(null)}
                            >
                              <div className="erp-calendar-event-time">{event.displayStart} - {event.displayEnd}</div>
                              {renderEventContent(event)}
                            </div>
                          );
                        }

                        const className = `${baseClass} erp-calendar-event-variant ${continuesClasses}`.trim();
                        return (
                          <div
                            key={`variant-${event.variant.id}-${event.startMinutes}`}
                            className={className}
                            style={{
                              top: `${event.topPercent}%`,
                              height: `${event.heightPercent}%`,
                              left: `${(event.column / event.columns) * 100}%`,
                              width: `${100 / event.columns}%`,
                            }}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setTooltip(null);
                              onVariantOpen?.(event.variant);
                            }}
                            onKeyDown={(keyboardEvent) => {
                              if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                                keyboardEvent.preventDefault();
                                setTooltip(null);
                                onVariantOpen?.(event.variant);
                              }
                            }}
                            onMouseEnter={(evt) => {
                              const target = evt.currentTarget;
                              if (!target) return;
                              setTooltip({
                                kind: 'variant',
                                variant: event.variant,
                                rect: target.getBoundingClientRect(),
                                pointer: { x: evt.clientX, y: evt.clientY },
                              });
                            }}
                            onMouseMove={(evt) => {
                              const target = evt.currentTarget;
                              if (!target) return;
                              setTooltip((current) =>
                                current && current.kind === 'variant' && current.variant.id === event.variant.id
                                  ? {
                                      kind: 'variant',
                                      variant: event.variant,
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
                              setTooltip({
                                kind: 'variant',
                                variant: event.variant,
                                rect: target.getBoundingClientRect(),
                              });
                            }}
                            onBlur={() => setTooltip(null)}
                          >
                            <div className="erp-calendar-event-time">{event.displayStart} - {event.displayEnd}</div>
                            {renderEventContent(event)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tooltip ? (
            <div className="erp-calendar-tooltip-overlay" style={tooltipStyle}>
              <div className="erp-calendar-tooltip-content">
                <div className="erp-calendar-tooltip-title">{tooltipTitle}</div>
                <div className="erp-calendar-tooltip-line">
                  {tooltipDateLabel} · {tooltipStartLabel} - {tooltipEndLabel}
                </div>
                {tooltipSecondaryText.length ? (
                  <div className="erp-calendar-tooltip-line">
                    {tooltipSecondaryText}
                  </div>
                ) : null}
                {tooltipTertiaryText.length ? (
                  <div className="erp-calendar-tooltip-line">
                    {tooltipTertiaryText}
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
