import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Badge, Button, Card, Col, Collapse, Form, ListGroup, Row, Spinner } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import {
  fetchComparativaDashboard,
  type ComparativaFilters,
  type ComparativaKpi,
  type ComparativaBinaryMix,
  type ComparativaTrend,
} from '../../features/reporting/api';

const METRIC_CONFIG: { key: string; label: string }[] = [
  { key: 'gepServicesSessions', label: 'GEP Services' },
  { key: 'formacionEmpresaSessions', label: 'Formacion Empresa' },
  { key: 'formacionAbiertaVariantesSessions', label: 'Formación Abierta' },
];

const BREAKDOWN_CONFIG = [
  {
    dimension: 'formacionEmpresaSite' as const,
    title: 'Formaciones Empresa por sedes',
    description: 'Sumatorio de sesiones por sede',
  },
  {
    dimension: 'formacionAbiertaSite' as const,
    title: 'Formaciones Abierta por sedes',
    description: 'Sumatorio de variantes por sede',
  },
  {
    dimension: 'gepServicesType' as const,
    title: 'GEP Services por tipo de servicio',
    description: 'Sumatorio de sesiones por tipo de servicio',
  },
];

const SPAIN_BOUNDS = { minLat: 27.5, maxLat: 44.2, minLng: -18.5, maxLng: 4.5 } as const;
const SPAIN_OUTLINE: Array<{ lat: number; lng: number }> = [
  { lat: 43.7, lng: -9.3 },
  { lat: 43.6, lng: -3.5 },
  { lat: 43.2, lng: -1.5 },
  { lat: 42.2, lng: 1.7 },
  { lat: 41.4, lng: 3.1 },
  { lat: 39.4, lng: 3.4 },
  { lat: 37.3, lng: -0.7 },
  { lat: 36.7, lng: -5.7 },
  { lat: 36.9, lng: -7.5 },
  { lat: 37.8, lng: -8.8 },
  { lat: 39.4, lng: -9.2 },
];

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfIsoWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function buildWeekRange(reference: Date) {
  const start = startOfIsoWeek(reference);
  const end = addDays(start, 6);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildMonthRange(reference: Date) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildQuarterRange(reference: Date) {
  const quarter = Math.floor(reference.getMonth() / 3);
  const startMonth = quarter * 3;
  const start = new Date(reference.getFullYear(), startMonth, 1);
  const end = new Date(reference.getFullYear(), startMonth + 3, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildYearRange(reference: Date) {
  const start = new Date(reference.getFullYear(), 0, 1);
  const end = new Date(reference.getFullYear(), 12, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

type FilterMultiSelectProps = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
};

function FilterMultiSelect({ label, options, selected, onChange, placeholder = '-' }: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.toLowerCase().includes(normalized));
  }, [options, search]);

  const summary = selected.length ? selected.join(', ') : placeholder;

  const toggleOption = (option: string, checked: boolean) => {
    const values = new Set(selected);
    if (checked) {
      values.add(option);
    } else {
      values.delete(option);
    }
    onChange(Array.from(values));
  };

  return (
    <div ref={containerRef} className="session-multiselect">
      <Form.Label className="small text-muted mb-1">{label}</Form.Label>
      <Form.Control
        type="text"
        size="sm"
        readOnly
        placeholder={placeholder}
        value={summary}
        className="session-multiselect-summary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
      />

      <Collapse in={open}>
        <div className="session-multiselect-panel mt-2">
          <Form.Control
            type="search"
            size="sm"
            placeholder="Buscar"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mb-2"
          />

          <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
            <ListGroup variant="flush">
              {filteredOptions.map((option) => {
                const id = `${label}-${option}`.replace(/\s+/g, '-').toLowerCase();
                const checked = selected.includes(option);
                return (
                  <ListGroup.Item key={option} className="py-1">
                    <Form.Check
                      type="checkbox"
                      id={id}
                      label={option}
                      checked={checked}
                      onChange={(event) => toggleOption(option, event.target.checked)}
                    />
                  </ListGroup.Item>
                );
              })}

              {filteredOptions.length === 0 && (
                <ListGroup.Item className="text-muted small">Sin opciones disponibles</ListGroup.Item>
              )}
            </ListGroup>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

function formatDisplayDate(value: string) {
  if (!value) return '';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatDisplayRange(range: { startDate: string; endDate: string }) {
  const start = formatDisplayDate(range.startDate);
  const end = formatDisplayDate(range.endDate);

  if (start && start === end) return start;
  if (start && end) return `${start} - ${end}`;
  return start || end || '';
}

function toPreviousYearDate(value: string) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  date.setFullYear(date.getFullYear() - 1);
  return formatDate(date);
}

function buildInitialPeriod(today: Date) {
  const start = new Date(today);
  start.setDate(1);

  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function buildComparisonPeriod(today: Date) {
  const start = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const end = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  } as const;
}

function normalizeSparkline(points?: number[]) {
  if (!Array.isArray(points)) return Array(12).fill(0);
  if (points.length >= 12) return points.slice(-12);
  const padding = Array(12 - points.length).fill(0);
  return [...padding, ...points];
}

export default function ComparativaDashboardPage() {
  const today = useMemo(() => new Date(), []);
  const [filters, setFilters] = useState<ComparativaFilters>({
    currentPeriod: buildInitialPeriod(today),
    previousPeriod: buildComparisonPeriod(today),
    granularity: 'isoWeek',
  });
  const [mapHeight, setMapHeight] = useState(420);
  const [heatmapRadius, setHeatmapRadius] = useState(14);
  const [heatmapScale, setHeatmapScale] = useState(100);

  const comparisonRangeLabel = useMemo(
    () => formatDisplayRange(filters.previousPeriod),
    [filters.previousPeriod],
  );

  const quickRanges = useMemo(
    () => [
      { label: 'Semana actual', range: buildWeekRange(today) },
      { label: 'Semana pasada', range: buildWeekRange(addDays(today, -7)) },
      { label: 'Mes actual', range: buildMonthRange(today) },
      { label: 'Mes pasado', range: buildMonthRange(new Date(today.getFullYear(), today.getMonth() - 1, 1)) },
      { label: 'Trimestre actual', range: buildQuarterRange(today) },
      { label: 'Trimestre pasado', range: buildQuarterRange(new Date(today.getFullYear(), today.getMonth() - 3, 1)) },
      { label: 'Año actual', range: buildYearRange(today) },
      { label: 'Año pasado', range: buildYearRange(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())) },
    ],
    [today],
  );

  const appliedFilters = useMemo(() => filters, [filters]);

  const appliedFilterBadges = useMemo(() => {
    const badges: { label: string; value: string }[] = [];

    if (filters.siteIds?.length) {
      badges.push({ label: 'Sede', value: filters.siteIds.join(', ') });
    }

    if (filters.comerciales?.length) {
      badges.push({ label: 'Comerciales', value: filters.comerciales.join(', ') });
    }

    if (filters.trainingTypes?.length) {
      badges.push({ label: 'Tipo de formación', value: filters.trainingTypes.join(', ') });
    }

    return badges;
  }, [filters.comerciales, filters.siteIds, filters.trainingTypes]);

  const dashboardQuery = useQuery({
    queryKey: [
      'reporting',
      'comparativa',
      appliedFilters.currentPeriod.startDate,
      appliedFilters.currentPeriod.endDate,
      appliedFilters.previousPeriod.startDate,
      appliedFilters.previousPeriod.endDate,
      appliedFilters.granularity,
      appliedFilters.siteIds?.join(',') ?? '',
      appliedFilters.trainingTypes?.join(',') ?? '',
      appliedFilters.comerciales?.join(',') ?? '',
    ],
    queryFn: () => fetchComparativaDashboard(appliedFilters),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }),
    [],
  );

  const percentageFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 1 }),
    [],
  );

  const formatPercentageDifference = useCallback(
    (current: number, previous: number) => {
      if (previous === 0) return '0%';

      const diff = current - previous;
      const percentage = (diff / previous) * 100;
      return `${percentage >= 0 ? '+' : ''}${percentageFormatter.format(percentage)}%`;
    },
    [percentageFormatter],
  );

  const siteOptions = dashboardQuery.data?.filterOptions.sites ?? [];
  const trainingTypeOptions = dashboardQuery.data?.filterOptions.trainingTypes ?? [];
  const comercialOptions = dashboardQuery.data?.filterOptions.comerciales ?? [];

  const handleDateChange = (
    period: 'currentPeriod' | 'previousPeriod',
    key: 'startDate' | 'endDate',
    value: string,
  ) => {
    setFilters((prev) => {
      const updated: ComparativaFilters = {
        ...prev,
        [period]: {
          ...prev[period],
          [key]: value,
        },
      };

      if (period === 'currentPeriod') {
        updated.previousPeriod = {
          ...prev.previousPeriod,
          [key]: toPreviousYearDate(value),
        };
      }

      return updated;
    });
  };

  const renderSparkline = (points: number[]) => {
    if (!points.length) return <div className="text-muted small">Sin datos</div>;
    const max = Math.max(...points);
    return (
      <div className="d-flex gap-1 align-items-end" style={{ height: 36 }}>
        {points.map((value, index) => {
          const height = max > 0 ? Math.max((value / max) * 100, 6) : 6;
          return (
            <div
              key={`${value}-${index}`}
              style={{
                width: 10,
                height: `${height}%`,
                background: 'linear-gradient(180deg, #0d6efd 0%, #6ea8fe 100%)',
                borderRadius: 4,
              }}
            />
          );
        })}
      </div>
    );
  };

  const applyQuickRange = (range: { startDate: string; endDate: string }) => {
    setFilters((prev) => ({
      ...prev,
      currentPeriod: range,
      previousPeriod: {
        startDate: toPreviousYearDate(range.startDate),
        endDate: toPreviousYearDate(range.endDate),
      },
    }));
  };

  const handleSelectorChange = (
    key: keyof Omit<ComparativaFilters, 'currentPeriod' | 'previousPeriod' | 'granularity'>,
    value: string | boolean,
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: typeof value === 'string' && value === '' ? undefined : value,
    }));
  };

  const handleMultiSelectorChange = (
    key: keyof Pick<ComparativaFilters, 'siteIds' | 'trainingTypes' | 'comerciales'>,
    values: string[],
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: values.length ? values : undefined,
    }));
  };

  const getBreakdownItems = (
    dimension: (typeof BREAKDOWN_CONFIG)[number]['dimension'],
  ) => {
    return dashboardQuery.data?.breakdowns.filter((item) => item.dimension === dimension) ?? [];
  };

  const buildBinarySlices = (mix: ComparativaBinaryMix | undefined) => {
    if (!mix) return [] as { label: string; percentage: number; value: number }[];
    const total = mix.yes + mix.no;
    if (total === 0) return [];
    return [
      { label: 'Sí', percentage: (mix.yes / total) * 100, value: mix.yes },
      { label: 'No', percentage: (mix.no / total) * 100, value: mix.no },
    ];
  };

  const getBinaryMix = (key: ComparativaBinaryMix['key']): ComparativaBinaryMix => {
    const placeholder: ComparativaBinaryMix = {
      key,
      label: METRIC_CONFIG.find((item) => item.key === key)?.label ?? '',
      yes: 0,
      no: 0,
    };

    return dashboardQuery.data?.binaryMixes.find((item) => item.key === key) ?? placeholder;
  };

  const renderMetric = (kpi: ComparativaKpi) => {
    const comparativaValue = numberFormatter.format(kpi.lastYearValue);
    const currentValue = numberFormatter.format(kpi.value);
    const absoluteDifference = kpi.value - kpi.lastYearValue;
    const absoluteDifferenceLabel = `${absoluteDifference >= 0 ? '+' : ''}${numberFormatter.format(absoluteDifference)}`;
    const percentageDifference = kpi.lastYearValue === 0
      ? 0
      : (absoluteDifference / kpi.lastYearValue) * 100;
    const percentageDifferenceLabel = `${percentageDifference >= 0 ? '+' : ''}${percentageFormatter.format(percentageDifference)}%`;
    const deltaVariant = percentageDifference > 0 ? 'success' : percentageDifference < 0 ? 'danger' : 'secondary';

    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between align-items-start">
            <Card.Title as="h6" className="mb-0">
              {kpi.label}
            </Card.Title>
            <Badge bg={deltaVariant} pill>
              {percentageDifferenceLabel}
            </Badge>
          </div>

          <div>
            <div className="fs-3 fw-semibold">{currentValue}</div>
            <div className="text-muted">Comparativa: {comparativaValue}</div>
            <div className="text-muted">Diferencia absoluta: {absoluteDifferenceLabel}</div>
          </div>

          <div>
            <div className="small text-muted mb-1">Evolutivo semanal · últimas 12 semanas</div>
            {renderSparkline(normalizeSparkline(kpi.sparkline))}
          </div>
        </Card.Body>
      </Card>
    );
  };

  const renderBreakdownCard = (
    config: (typeof BREAKDOWN_CONFIG)[number],
  ) => {
    const items = getBreakdownItems(config.dimension);

    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <Card.Title as="h6" className="mb-1">
              {config.title}
            </Card.Title>
            <div className="text-muted small">{config.description}</div>
          </div>

          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th className="text-muted small">Etiqueta</th>
                  <th className="text-muted small text-end">Actual</th>
                  <th className="text-muted small text-end">Comparativa</th>
                  <th className="text-muted small text-end">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted small py-3">
                      Sin datos para el periodo seleccionado
                    </td>
                  </tr>
                )}
                {items.map((item) => {
                  const diff = item.current - item.previous;
                  const diffLabel = `${diff >= 0 ? '+' : ''}${numberFormatter.format(diff)}`;
                  const percentageLabel = formatPercentageDifference(item.current, item.previous);
                  const badgeVariant = diff > 0 ? 'success' : diff < 0 ? 'danger' : 'secondary';

                  return (
                    <tr key={item.label}>
                      <td className="small">{item.label}</td>
                      <td className="text-end fw-semibold">{numberFormatter.format(item.current)}</td>
                      <td className="text-end">{numberFormatter.format(item.previous)}</td>
                      <td className="text-end">
                        <div className="d-flex align-items-center justify-content-end gap-2">
                          <Badge bg={badgeVariant}>{diffLabel}</Badge>
                          <span className="text-muted small">{percentageLabel}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card.Body>
      </Card>
    );
  };

  const getMetricData = (key: string): ComparativaKpi => {
    const placeholder: ComparativaKpi = {
      key,
      label: METRIC_CONFIG.find((item) => item.key === key)?.label ?? key,
      value: 0,
      lastYearValue: 0,
      deltaPercentage: 0,
      sparkline: Array(12).fill(0),
    };
    return dashboardQuery.data?.highlights.find((item) => item.key === key) ?? placeholder;
  };

  const renderWeeklyComparisonChart = (
    points: ComparativaTrend['points'],
    comparisonLabel: string,
  ) => {
    if (points.length === 0) {
      return <div className="text-muted small">Sin datos para mostrar</div>;
    }

    const chartWidth = 760;
    const chartHeight = 260;
    const paddingX = 56;
    const paddingY = 28;
    const innerWidth = chartWidth - paddingX * 2;
    const innerHeight = chartHeight - paddingY * 2;
    const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;
    const barWidth = points.length > 1 ? Math.min(36, innerWidth / points.length / 1.4) : 32;
    const maxValue = Math.max(1, ...points.flatMap((point) => [point.currentValue, point.previousValue]));

    const toX = (index: number) => paddingX + xStep * index;
    const toY = (value: number) => paddingY + innerHeight - (value / maxValue) * innerHeight;

    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index).toFixed(1)} ${toY(point.previousValue).toFixed(1)}`)
      .join(' ');

    const yTicks = Array.from({ length: 5 }, (_, index) => Math.round((maxValue * index) / 4));

    return (
      <div className="w-100">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-100" role="img" aria-label="Evolución semanal">
          <g>
            {yTicks.map((tick) => {
              const y = toY(tick);
              return (
                <g key={tick}>
                  <line x1={paddingX} x2={paddingX + innerWidth} y1={y} y2={y} stroke="#e9ecef" strokeWidth={1} />
                  <text x={paddingX - 8} y={y + 4} textAnchor="end" className="text-muted" fontSize={10}>
                    {numberFormatter.format(tick)}
                  </text>
                </g>
              );
            })}

            {points.map((point, index) => {
              const x = toX(index) - barWidth / 2;
              const barHeight = innerHeight - (point.currentValue / maxValue) * innerHeight;
              const barY = paddingY + barHeight;
              return (
                <rect
                  key={`${point.periodLabel}-bar`}
                  x={x}
                  y={barY}
                  width={barWidth}
                  height={innerHeight - barHeight}
                  rx={6}
                  fill="url(#barGradient)"
                />
              );
            })}

            {linePath && (
              <>
                <path d={linePath} fill="none" stroke="#198754" strokeWidth={2} />
                {points.map((point, index) => (
                  <circle
                    key={`${point.periodLabel}-dot`}
                    cx={toX(index)}
                    cy={toY(point.previousValue)}
                    r={4}
                    fill="#198754"
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                ))}
              </>
            )}

            {points.map((point, index) => (
              <text
                key={`${point.periodLabel}-label`}
                x={toX(index)}
                y={chartHeight - 6}
                textAnchor="middle"
                className="text-muted"
                fontSize={10}
              >
                W{point.isoWeek}
              </text>
            ))}
          </g>

          <defs>
            <linearGradient id="barGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0d6efd" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#6ea8fe" stopOpacity="0.8" />
            </linearGradient>
          </defs>
        </svg>

        <div className="d-flex align-items-center gap-3 mt-2 small text-muted">
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 14, height: 14, backgroundColor: '#0d6efd', borderRadius: 2, display: 'inline-block' }} />
            Periodo seleccionado
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span
              style={{ width: 14, height: 14, borderRadius: 999, display: 'inline-block', backgroundColor: '#198754' }}
            />
            {comparisonLabel ? `Comparativa (${comparisonLabel})` : 'Comparativa (línea)'}
          </span>
        </div>
      </div>
    );
  };

  const getTrendData = (metric: ComparativaTrend['metric']) => {
    const placeholder: ComparativaTrend = { metric, label: '', points: [] } as ComparativaTrend;
    return dashboardQuery.data?.trends.find((item) => item.metric === metric) ?? placeholder;
  };

  const renderDonutChart = (slices: { label: string; percentage: number; value: number }[]) => {
    if (slices.length === 0) {
      return <div className="text-muted small">Sin datos</div>;
    }

    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const colors = ['#0d6efd', '#adb5bd'];

    return (
      <div className="d-flex align-items-center gap-3">
        <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Distribución sí/no">
          <g transform="rotate(-90 60 60)">
            {slices.map((slice, index) => {
              const dash = (slice.percentage / 100) * circumference;
              const circle = (
                <circle
                  key={`${slice.label}-${index}`}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="transparent"
                  stroke={colors[index]}
                  strokeWidth={16}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return circle;
            })}
          </g>
          <text x="50%" y="52%" textAnchor="middle" className="fw-semibold" fontSize={16} dominantBaseline="middle">
            {percentageFormatter.format(slices[0].percentage)}%
          </text>
          <text x="50%" y="62%" textAnchor="middle" className="text-muted" fontSize={10} dominantBaseline="middle">
            Sí · {numberFormatter.format(slices[0].value)}
          </text>
        </svg>

        <div className="d-flex flex-column gap-1 small">
          {slices.map((slice, index) => (
            <div key={`${slice.label}-${index}`} className="d-flex align-items-center gap-2">
              <span
                style={{ width: 14, height: 14, borderRadius: 3, display: 'inline-block', backgroundColor: colors[index] }}
              />
              <span className="text-muted">{slice.label}</span>
              <span className="fw-semibold">
                {percentageFormatter.format(slice.percentage)}% · {numberFormatter.format(slice.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderHeatmapCard = () => {
    const heatmapPoints = dashboardQuery.data?.heatmap ?? [];
    const maxSessions = heatmapPoints.length ? Math.max(...heatmapPoints.map((item) => item.sessions)) : 0;

    const getHeatColor = (intensity: number) => {
      const clamped = Math.max(0, Math.min(1, intensity));
      const r = Math.round(255 * clamped);
      const g = Math.round(170 * (1 - clamped));
      const b = 64;
      return `rgba(${r}, ${g}, ${b}, 0.78)`;
    };

    const projectPoint = (lat: number, lng: number) => {
      const x = ((lng - SPAIN_BOUNDS.minLng) / (SPAIN_BOUNDS.maxLng - SPAIN_BOUNDS.minLng)) * 100;
      const y =
        ((SPAIN_BOUNDS.maxLat - lat) / (SPAIN_BOUNDS.maxLat - SPAIN_BOUNDS.minLat)) * 100;
      return { x, y };
    };

    const outlinePoints = SPAIN_OUTLINE.map((point) => {
      const projected = projectPoint(point.lat, point.lng);
      return `${projected.x},${projected.y}`;
    }).join(' ');

    return (
      <Card className="shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div className="d-flex justify-content-between flex-wrap gap-2">
            <div>
              <Card.Title as="h6" className="mb-1">
                Mapa de calor de sesiones
              </Card.Title>
              <div className="text-muted small">Direcciones mapeadas de las sesiones registradas</div>
            </div>

            <div className="d-flex align-items-center gap-3 flex-wrap">
              <div className="d-flex flex-column" style={{ minWidth: 140 }}>
                <Form.Label className="small text-muted mb-1">Altura del mapa</Form.Label>
                <Form.Range
                  min={280}
                  max={720}
                  value={mapHeight}
                  onChange={(event) => setMapHeight(Number.parseInt(event.target.value, 10))}
                />
              </div>
              <div className="d-flex flex-column" style={{ minWidth: 160 }}>
                <Form.Label className="small text-muted mb-1">Tamaño del calor</Form.Label>
                <Form.Range
                  min={8}
                  max={28}
                  value={heatmapRadius}
                  onChange={(event) => setHeatmapRadius(Number.parseInt(event.target.value, 10))}
                />
              </div>
              <div className="d-flex flex-column" style={{ minWidth: 160 }}>
                <Form.Label className="small text-muted mb-1">Zoom del mapa</Form.Label>
                <Form.Range
                  min={80}
                  max={140}
                  value={heatmapScale}
                  onChange={(event) => setHeatmapScale(Number.parseInt(event.target.value, 10))}
                />
              </div>
            </div>
          </div>

          {heatmapPoints.length === 0 ? (
            <div className="text-muted small">No hay direcciones con coordenadas en el rango seleccionado.</div>
          ) : (
            <div
              className="border rounded position-relative"
              style={{ height: mapHeight, overflow: 'hidden', background: 'radial-gradient(circle at 20% 20%, #f8f9fa, #e9ecef)' }}
            >
              <div
                className="position-absolute"
                style={{ inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg
                  viewBox="0 0 100 100"
                  style={{ width: `${heatmapScale}%`, height: `${heatmapScale}%`, maxWidth: '100%', maxHeight: '100%' }}
                  role="img"
                  aria-label="Mapa de calor de España"
                >
                  <defs>
                    <radialGradient id="heatmapGlow" cx="50%" cy="50%" r="80%">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <rect x="0" y="0" width="100" height="100" fill="url(#heatmapGlow)" />
                  <polygon points={outlinePoints} fill="#f1f3f5" stroke="#ced4da" strokeWidth={0.4} />
                  {heatmapPoints.map((point, index) => {
                    const intensity = maxSessions > 0 ? point.sessions / maxSessions : 0;
                    const radius = Math.max(2.6, (heatmapRadius / 10) * (0.6 + intensity));
                    const color = getHeatColor(intensity);
                    const { x, y } = projectPoint(point.latitude, point.longitude);

                    return (
                      <g key={`${point.latitude}-${point.longitude}-${index}`}>
                        <circle cx={x} cy={y} r={radius * 2.2} fill={color} opacity={0.35} />
                        <circle cx={x} cy={y} r={radius} fill={color} opacity={0.85} />
                        <title>
                          {(point.address || 'Dirección desconocida') + ` · Sesiones: ${numberFormatter.format(point.sessions)}`}
                        </title>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  };

  const renderWeeklyTrendCard = (
    title: string,
    description: string,
    metric: ComparativaTrend['metric'],
  ) => {
    const trend = getTrendData(metric);
    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <Card.Title as="h6" className="mb-1">
              {title}
            </Card.Title>
            <div className="text-muted small">{description}</div>
          </div>

          {renderWeeklyComparisonChart(trend.points, comparisonRangeLabel)}
        </Card.Body>
      </Card>
    );
  };

  const getRankingByCategory = (category: string) => {
    return dashboardQuery.data?.ranking.filter((item) => item.category === category) ?? [];
  };

  const renderRankingTable = (
    title: string,
    category: string,
    emptyMessage: string,
    options?: { columnLabel?: string; description?: string },
  ) => {
    const items = getRankingByCategory(category);
    const columnLabel = options?.columnLabel ?? 'Producto';
    const description = options?.description ?? 'Top productos en el rango seleccionado';
    const MAX_VISIBLE_ITEMS = 5;
    const RANKING_ROW_HEIGHT = 56;
    const RANKING_HEADER_HEIGHT = 48;
    const rankingTableMaxHeight = RANKING_HEADER_HEIGHT + MAX_VISIBLE_ITEMS * RANKING_ROW_HEIGHT;
    return (
      <Card className="h-100 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <Card.Title as="h6" className="mb-1">{title}</Card.Title>
            <div className="text-muted small">{description}</div>
          </div>

          <div className="table-responsive" style={{ maxHeight: rankingTableMaxHeight, overflowY: 'auto' }}>
            <table className="table align-middle mb-0">
              <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bs-body-bg)', zIndex: 1 }}>
                <tr>
                  <th className="text-muted small">{columnLabel}</th>
                  <th className="text-muted small text-end">Actual</th>
                  <th className="text-muted small text-end">Comparativa</th>
                  <th className="text-muted small text-end">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted small py-3">
                      {emptyMessage}
                    </td>
                  </tr>
                )}
                {items.map((item) => {
                  const diff = item.currentValue - item.previousValue;
                  const badgeVariant = diff > 0 ? 'success' : diff < 0 ? 'danger' : 'secondary';
                  const diffLabel = `${diff >= 0 ? '+' : ''}${numberFormatter.format(diff)}`;
                  const percentageLabel = formatPercentageDifference(item.currentValue, item.previousValue);

                  return (
                    <tr key={`${category}-${item.label}`}>
                      <td className="small">{item.label}</td>
                      <td className="text-end fw-semibold">{numberFormatter.format(item.currentValue)}</td>
                      <td className="text-end">{numberFormatter.format(item.previousValue)}</td>
                      <td className="text-end">
                        <div className="d-flex align-items-center justify-content-end gap-2">
                          <Badge bg={badgeVariant}>{diffLabel}</Badge>
                          <span className="text-muted small">{percentageLabel}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card.Body>
      </Card>
    );
  };

  const renderContent = () => {
    if (dashboardQuery.isLoading) {
      return (
        <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 240 }}>
          <Spinner animation="border" role="status" />
        </div>
      );
    }

    if (dashboardQuery.isError) {
      const errorMessage = isApiError(dashboardQuery.error)
        ? dashboardQuery.error.message
        : 'No se pudo cargar la comparativa. Inténtalo de nuevo más tarde.';
      return <div className="text-danger">{errorMessage}</div>;
    }

    const comparisonDescription = comparisonRangeLabel
      ? `Comparativa del periodo frente al rango ${comparisonRangeLabel}`
      : 'Comparativa del periodo frente al rango seleccionado';

    return (
      <div className="d-flex flex-column gap-4 mt-3">
        <Row xs={1} md={2} lg={3} className="g-3">
          {METRIC_CONFIG.map((metric) => (
            <Col key={metric.key}>{renderMetric(getMetricData(metric.key))}</Col>
          ))}
        </Row>

        <Row className="g-3">
          <Col xs={12} lg={6}>
            {renderWeeklyTrendCard(
              'Formación Empresa por semana ISO',
              comparisonDescription,
              'formacionEmpresaSessions',
            )}
          </Col>
          <Col xs={12} lg={6}>
            {renderWeeklyTrendCard(
              'GEP Services por semana ISO',
              comparisonDescription,
              'gepServicesSessions',
            )}
          </Col>
        </Row>

        <Row className="g-3">
          {[ 
            { key: 'formacionEmpresaFundae', description: 'Sesiones con FUNDAE sí/no' },
            { key: 'formacionEmpresaCaes', description: 'Sesiones con CAES sí/no' },
            { key: 'formacionEmpresaHotel', description: 'Sesiones con Hotel sí/no' },
            { key: 'gepServicesCaes', description: 'Sesiones con CAES sí/no' },
          ].map((item) => {
            const mix = getBinaryMix(item.key as ComparativaBinaryMix['key']);
            const slices = buildBinarySlices(mix);

            return (
              <Col xs={12} md={6} lg={3} key={item.key}>
                <Card className="h-100 shadow-sm">
                  <Card.Body className="d-flex flex-column gap-3">
                    <div>
                      <Card.Title as="h6" className="mb-1">
                        {mix.label || 'Sin etiqueta'}
                      </Card.Title>
                      <div className="text-muted small">{item.description}</div>
                    </div>

                    {renderDonutChart(slices)}
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>

        <Row className="g-3">
          {BREAKDOWN_CONFIG.map((item) => (
            <Col xs={12} md={6} lg={4} key={item.dimension}>
              {renderBreakdownCard(item)}
            </Col>
          ))}
        </Row>

        <Row className="g-3">
          <Col xs={12} lg={4}>
            {renderRankingTable(
              'Productos más usados · Formación Empresa',
              'formacionEmpresa',
              'Sin productos registrados en el rango',
            )}
          </Col>
          <Col xs={12} lg={4}>
            {renderRankingTable(
              'Productos más usados · GEP Services',
              'gepServices',
              'Sin productos registrados en el rango',
            )}
          </Col>
          <Col xs={12} lg={4}>
            {renderRankingTable(
              'Productos más usados · Formación Abierta',
              'formacionAbierta',
              'Sin productos registrados en el rango',
            )}
          </Col>
        </Row>

        <Row className="g-3">
          <Col xs={12} lg={4}>
            {renderRankingTable(
              'Formadores Frecuentes · Formación Empresa',
              'formacionEmpresaTrainers',
              'Sin formadores registrados en el rango',
              { columnLabel: 'Formador', description: 'Top formadores en el rango seleccionado' },
            )}
          </Col>
          <Col xs={12} lg={4}>
            {renderRankingTable(
              'Formadores Frecuentes · GEP Services',
              'gepServicesTrainers',
              'Sin formadores registrados en el rango',
              { columnLabel: 'Formador', description: 'Top formadores en el rango seleccionado' },
            )}
          </Col>
          <Col xs={12} lg={4}>
            {renderRankingTable(
              'Formadores Frecuentes · Formación Abierta',
              'formacionAbiertaTrainers',
              'Sin formadores registrados en el rango',
              { columnLabel: 'Formador', description: 'Top formadores en el rango seleccionado' },
            )}
          </Col>
        </Row>

        {renderHeatmapCard()}
      </div>
    );
  };

  return (
    <div className="p-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div className="d-flex align-items-center gap-2">
          <h4 className="mb-0">Comparativa Formaciones y Servicios</h4>
          <div className="text-muted">Elige fechas y compara</div>
        </div>
      </div>

      <Card className="shadow-sm">
        <Card.Body className="pb-3">
          <div className="d-flex flex-wrap gap-2 mb-2">
            {quickRanges.map((item) => (
              <Button
                key={item.label}
                size="sm"
                variant="outline-primary"
                onClick={() => applyQuickRange(item.range)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <Row className="g-2 align-items-end">
            <Col xs={12} md={6} lg={3}>
              <div className="fw-semibold mb-1 small text-uppercase text-muted">Fechas</div>
              <Row className="g-1">
                <Col>
                  <Form.Label className="small text-muted mb-1">Inicio</Form.Label>
                  <Form.Control
                    type="date"
                    size="sm"
                    value={filters.currentPeriod.startDate}
                    onChange={(event) => handleDateChange('currentPeriod', 'startDate', event.target.value)}
                  />
                </Col>
                <Col>
                  <Form.Label className="small text-muted mb-1">Fin</Form.Label>
                  <Form.Control
                    type="date"
                    size="sm"
                    value={filters.currentPeriod.endDate}
                    onChange={(event) => handleDateChange('currentPeriod', 'endDate', event.target.value)}
                  />
                </Col>
              </Row>
            </Col>

            <Col xs={12} md={6} lg={3}>
              <div className="fw-semibold mb-1 small text-uppercase text-muted">Comparativa</div>
              <Row className="g-1">
                <Col>
                  <Form.Label className="small text-muted mb-1">Inicio</Form.Label>
                  <Form.Control
                    type="date"
                    size="sm"
                    value={filters.previousPeriod.startDate}
                    onChange={(event) => handleDateChange('previousPeriod', 'startDate', event.target.value)}
                  />
                </Col>
                <Col>
                  <Form.Label className="small text-muted mb-1">Fin</Form.Label>
                  <Form.Control
                    type="date"
                    size="sm"
                    value={filters.previousPeriod.endDate}
                    onChange={(event) => handleDateChange('previousPeriod', 'endDate', event.target.value)}
                  />
                </Col>
              </Row>
            </Col>

            <Col xs={12} md={6} lg={2}>
              <FilterMultiSelect
                label="Sede"
                options={siteOptions}
                selected={filters.siteIds ?? []}
                onChange={(values) => handleMultiSelectorChange('siteIds', values)}
              />
            </Col>

            <Col xs={12} md={6} lg={2}>
              <FilterMultiSelect
                label="Comerciales"
                options={comercialOptions}
                selected={filters.comerciales ?? []}
                onChange={(values) => handleMultiSelectorChange('comerciales', values)}
              />
            </Col>

            <Col xs={12} md={6} lg={2}>
              <FilterMultiSelect
                label="Tipo de formación"
                options={trainingTypeOptions}
                selected={filters.trainingTypes ?? []}
                onChange={(values) => handleMultiSelectorChange('trainingTypes', values)}
              />
            </Col>

          </Row>

          <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
            <div className="fw-semibold small text-muted text-uppercase me-1">Filtros aplicados</div>

            {appliedFilterBadges.length === 0 ? (
              <div className="text-muted small">Sin filtros adicionales</div>
            ) : (
              appliedFilterBadges.map((item) => (
                <Badge key={item.label} bg="light" text="dark" className="border fw-normal">
                  <span className="text-muted">{item.label}: </span>
                  <span className="fw-semibold text-dark">{item.value}</span>
                </Badge>
              ))
            )}
          </div>
        </Card.Body>
      </Card>

      {renderContent()}
    </div>
  );
}
