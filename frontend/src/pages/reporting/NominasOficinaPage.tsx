import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accordion, Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import {
  fetchTrainerExtraCosts,
  fetchOfficePayrolls,
  saveOfficePayroll,
  type TrainerExtraCostFieldKey,
  type OfficePayrollUpsertPayload,
  type OfficePayrollRecord,
  type OfficePayrollResponse,
} from '../../features/reporting/api';
import { type UserSummary, updateUser } from '../../api/users';
import { fetchUserDocuments, type UserDocument } from '../../api/userDocuments';
import { UserFormModal, buildPayrollPayload, type UserFormValues } from '../usuarios/UsersPage';

type NominasOficinaPageProps = {
  title?: string;
  description?: string;
  filterEntries?: (entry: OfficePayrollRecord) => boolean;
  enableSessionsAction?: boolean;
  allowExtrasEdit?: boolean;
};

const DEFAULT_WEEKLY_HOURS = '40';

function parseLocaleNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;

  const cleaned = trimmed.replace(/%/g, '').replace(/,/g, '.');
  const parsed = Number(cleaned);

  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeNumber(value: string, fallback: number | null = null): number | null {
  const parsed = parseLocaleNumber(value);
  if (parsed === null) return fallback;
  return Number(parsed.toFixed(2));
}

function parseAnnualBaseRetencion(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;

  const normalized = trimmed.replace(/\./g, '').replace(/,/g, '.');
  const parsed = Number(normalized);

  return Number.isNaN(parsed) ? null : parsed;
}

function calculateBaseRetencionMonthly(payroll: { baseRetencion: string; baseRetencionDetalle: string }): number | null {
  const annualBase = parseAnnualBaseRetencion(payroll.baseRetencionDetalle);
  if (annualBase !== null) {
    return Number((annualBase / 12).toFixed(2));
  }

  const monthlyBase = normalizeNumber(payroll.baseRetencion);
  if (monthlyBase === null) return null;

  return Number(monthlyBase.toFixed(2));
}

function calculateSalarioBruto(baseRetencionMensual: number | null, horasSemana: string): number | null {
  const horas = normalizeNumber(horasSemana, Number(DEFAULT_WEEKLY_HOURS));

  if (baseRetencionMensual === null || horas === null) return null;

  return Number(((baseRetencionMensual / 40) * horas).toFixed(2));
}

function parsePercentageInput(value: string): number | null {
  const parsed = parseLocaleNumber(value);
  if (parsed === null) return null;

  const hasPercentSymbol = value.includes('%');
  const shouldNormalizeToPercent = hasPercentSymbol || parsed > 1;

  return shouldNormalizeToPercent ? parsed / 100 : parsed;
}

function parseSumExpression(expression: string, parser: (value: string) => number | null): number | null {
  if (!expression.trim()) return 0;

  const parts = expression.split('+');
  let total = 0;
  let parsedAny = false;

  for (const part of parts) {
    const normalized = part.trim();
    if (!normalized) continue;

    const parsed = parser(normalized);
    if (parsed === null) return null;

    parsedAny = true;
    total += parsed;
  }

  return parsedAny ? total : 0;
}
function formatCurrencyValue(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end),
  };
}

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function resolveDisplayValue(value: string | number | null, fallback?: string | number | null): string {
  const raw = value ?? fallback;
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'number') return formatCurrencyValue(raw);
  return String(raw);
}

function resolveNumericValue(value: number | null, fallback?: number | null): number | null {
  const raw = value ?? fallback;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function calculateTotals(entries: OfficePayrollRecord[]) {
  return entries.reduce(
    (acc, entry) => {
      const salarioBruto = resolveNumericValue(entry.salarioBrutoTotal);
      const aportacion = resolveNumericValue(entry.aportacionSsIrpf);
      const salarioLimpio = resolveNumericValue(entry.salarioLimpio);

      acc.count += 1;
      acc.salarioBruto += salarioBruto ?? 0;
      acc.aportacion += aportacion ?? 0;
      acc.salarioLimpio += salarioLimpio ?? 0;
      return acc;
    },
    { count: 0, salarioBruto: 0, aportacion: 0, salarioLimpio: 0 },
  );
}

type ExtrasModalProps = {
  entry: OfficePayrollRecord | null;
  onHide: () => void;
  onSaved: (entry: OfficePayrollRecord) => void;
  allowEdit: boolean;
};

type ExtrasFieldConfig = {
  key: 'dietas' | 'kilometraje' | 'pernocta' | 'nocturnidad' | 'festivo' | 'horasExtras' | 'otrosGastos';
  label: string;
  col: number;
  entryKey: keyof OfficePayrollRecord;
  costsKey: TrainerExtraCostFieldKey;
};

type ExtrasSummaryKey = ExtrasFieldConfig['key'];

const EXTRAS_SUMMARY_FIELDS = [
  { key: 'dietas', label: 'Dietas', col: 6, entryKey: 'dietas', costsKey: 'dietas' },
  { key: 'kilometraje', label: 'Kilometraje', col: 6, entryKey: 'kilometrajes', costsKey: 'kilometraje' },
  { key: 'pernocta', label: 'Pernocta', col: 6, entryKey: 'pernocta', costsKey: 'pernocta' },
  { key: 'nocturnidad', label: 'Nocturnidad', col: 6, entryKey: 'nocturnidad', costsKey: 'nocturnidad' },
  { key: 'festivo', label: 'Festivo', col: 6, entryKey: 'festivo', costsKey: 'festivo' },
  { key: 'horasExtras', label: 'Horas extras', col: 6, entryKey: 'horasExtras', costsKey: 'horasExtras' },
  { key: 'otrosGastos', label: 'Otros gastos', col: 12, entryKey: 'otrosGastos', costsKey: 'gastosExtras' },
] as const satisfies ExtrasFieldConfig[];
const EXTRAS_TOTAL_FIELDS: ExtrasSummaryKey[] = [
  'dietas',
  'kilometraje',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horasExtras',
  'otrosGastos',
];

const extrasInitialFields = EXTRAS_SUMMARY_FIELDS.reduce((acc, field) => {
  acc[field.key] = '';
  return acc;
}, {} as Record<ExtrasSummaryKey, string>);

const PAYROLL_BASE_FIELDS: Array<keyof OfficePayrollRecord> = [
  'id',
  'userId',
  'fullName',
  'email',
  'role',
  'trainerFixedContract',
  'year',
  'month',
  'startDate',
  'convenio',
  'categoria',
  'antiguedad',
  'horasSemana',
  'baseRetencion',
  'baseRetencionDetalle',
  'salarioBruto',
  'salarioBrutoTotal',
  'retencion',
  'aportacionSsIrpf',
  'aportacionSsIrpfDetalle',
  'salarioLimpio',
  'contingenciasComunes',
  'contingenciasComunesDetalle',
  'totalEmpresa',
  'defaultConvenio',
  'defaultCategoria',
  'defaultAntiguedad',
  'defaultHorasSemana',
  'defaultBaseRetencion',
  'defaultBaseRetencionDetalle',
  'defaultSalarioBruto',
  'defaultSalarioBrutoTotal',
  'defaultRetencion',
  'defaultAportacionSsIrpf',
  'defaultAportacionSsIrpfDetalle',
  'defaultSalarioLimpio',
  'defaultContingenciasComunes',
  'defaultContingenciasComunesDetalle',
  'defaultTotalEmpresa',
];

function preservePayrollBaseValues(
  existing: OfficePayrollRecord,
  updated: OfficePayrollRecord,
): OfficePayrollRecord {
  const merged = { ...existing, ...updated };
  for (const field of PAYROLL_BASE_FIELDS) {
    if (updated[field] === null || updated[field] === undefined) {
      merged[field] = existing[field];
    }
  }
  return merged;
}

function areExtraValuesEqual(current: string, initial: string): boolean {
  const currentValue = normalizeNumber(current);
  const initialValue = normalizeNumber(initial);
  if (currentValue === null && initialValue === null) {
    return true;
  }
  return currentValue === initialValue;
}

function buildExtrasUpdatePayload(
  entry: OfficePayrollRecord,
  fields: Record<ExtrasSummaryKey, string>,
  initialFields: Record<ExtrasSummaryKey, string>,
  totalExtras: string,
): OfficePayrollUpsertPayload | null {
  let hasChanges = false;
  const payload: OfficePayrollUpsertPayload = {
    userId: entry.userId,
    year: entry.year,
    month: entry.month,
  };

  for (const field of EXTRAS_SUMMARY_FIELDS) {
    if (areExtraValuesEqual(fields[field.key], initialFields[field.key])) {
      continue;
    }
    hasChanges = true;
    switch (field.key) {
      case 'kilometraje':
        payload.kilometrajes = fields[field.key];
        break;
      case 'horasExtras':
        payload.horasExtras = fields[field.key];
        break;
      case 'otrosGastos':
        payload.otrosGastos = fields[field.key];
        break;
      default:
        payload[field.key] = fields[field.key];
        break;
    }
  }

  if (hasChanges) {
    payload.totalExtras = totalExtras;
    return payload;
  }

  return null;
}

function ExtrasModal({ entry, onHide, onSaved, allowEdit }: ExtrasModalProps) {
  const navigate = useNavigate();
  const [fields, setFields] = useState<Record<ExtrasSummaryKey, string>>(extrasInitialFields);
  const [initialFields, setInitialFields] =
    useState<Record<ExtrasSummaryKey, string>>(extrasInitialFields);

  const refreshedPayrollQuery = useQuery({
    queryKey: ['reporting', 'nominas-oficina-entry', entry?.userId ?? null, entry?.year ?? null, entry?.month ?? null],
    queryFn: async () => {
      const response = await fetchOfficePayrolls(entry?.year);
      return (
        response.entries.find(
          (item) =>
            item.userId === entry?.userId && item.year === entry?.year && item.month === entry?.month,
        ) ?? null
      );
    },
    enabled: Boolean(entry?.userId && entry?.year && entry?.month),
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (entry?.userId && entry?.year && entry?.month) {
      void refreshedPayrollQuery.refetch();
    }
  }, [entry?.userId, entry?.year, entry?.month, refreshedPayrollQuery]);

  useEffect(() => {
    if (!entry) {
      setFields(extrasInitialFields);
      setInitialFields(extrasInitialFields);
      return;
    }
    const sourceEntry = refreshedPayrollQuery.data ?? entry;
    const nextFields = { ...extrasInitialFields };
    for (const field of EXTRAS_SUMMARY_FIELDS) {
      const rawValue = sourceEntry[field.entryKey];
      nextFields[field.key] = typeof rawValue === 'number' ? rawValue.toFixed(2) : rawValue ?? '';
    }
    setFields(nextFields);
    setInitialFields(nextFields);
  }, [entry, refreshedPayrollQuery.data]);

  const monthRange = useMemo(() => {
    if (!entry) return null;
    return buildMonthRange(entry.year, entry.month);
  }, [entry]);

  const {
    data: documents = [],
    isLoading: isLoadingDocuments,
    error: documentsError,
  } = useQuery<UserDocument[]>({
    queryKey: ['user-documents', entry?.userId],
    queryFn: () => fetchUserDocuments(entry?.userId as string),
    enabled: Boolean(entry?.userId),
    refetchOnMount: 'always',
  });

  const extraCostsQuery = useQuery({
    queryKey: [
      'reporting',
      'costes-extra-summary',
      entry?.userId ?? null,
      monthRange?.startDate ?? null,
      monthRange?.endDate ?? null,
    ],
    queryFn: () =>
      fetchTrainerExtraCosts({
        startDate: monthRange?.startDate,
        endDate: monthRange?.endDate,
      }),
    enabled: Boolean(entry?.userId && monthRange),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  });

  const matchingExtraCosts = useMemo(() => {
    if (!entry) return [];
    return (extraCostsQuery.data ?? []).filter(
      (item) => item.trainerId === entry.userId || item.trainerUserId === entry.userId,
    );
  }, [entry, extraCostsQuery.data]);

  const extrasTotals = useMemo(() => {
    const totals = EXTRAS_SUMMARY_FIELDS.reduce((acc, field) => {
      acc[field.key] = 0;
      return acc;
    }, {} as Record<ExtrasSummaryKey, number>);

    for (const item of matchingExtraCosts) {
      for (const field of EXTRAS_SUMMARY_FIELDS) {
        totals[field.key] += item.costs[field.costsKey] ?? 0;
      }
    }

    for (const field of EXTRAS_SUMMARY_FIELDS) {
      totals[field.key] = Number(totals[field.key].toFixed(2));
    }

    return totals;
  }, [matchingExtraCosts]);

  const totalExtrasDisplay = useMemo(() => {
    const total = EXTRAS_TOTAL_FIELDS.reduce((sum, fieldKey) => sum + extrasTotals[fieldKey], 0);
    return total.toFixed(2);
  }, [extrasTotals]);

  const editableTotalExtras = useMemo(() => {
    const total = EXTRAS_TOTAL_FIELDS.reduce((sum, key) => {
      const parsed = parseLocaleNumber(fields[key]) ?? 0;
      return sum + parsed;
    }, 0);
    return total.toFixed(2);
  }, [fields]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry) {
        throw new Error('No hay datos de nómina para guardar.');
      }
      const payload = buildExtrasUpdatePayload(entry, fields, initialFields, editableTotalExtras);
      if (!payload) {
        return entry;
      }
      return saveOfficePayroll(payload);
    },
    onSuccess: (saved) => {
      onSaved(entry ? preservePayrollBaseValues(entry, saved) : saved);
    },
  });

  const matchingExpenseDocuments = useMemo(() => {
    if (!entry || !documents?.length) return [];

    return documents.filter((document) => {
      if (
        !['gasto', 'parking_peaje_kilometraje', 'dietas'].includes(document.document_type ?? '')
      ) {
        return false;
      }
      if (!document.created_at) return false;

      const createdAt = new Date(document.created_at);
      if (Number.isNaN(createdAt.getTime())) return false;

      return (
        createdAt.getUTCFullYear() === entry.year &&
        createdAt.getUTCMonth() + 1 === entry.month
      );
    });
  }, [documents, entry]);

  if (!entry) return null;
  const monthLabel = MONTH_LABELS[entry.month - 1] ?? `${entry.month}`;
  const isLoadingExtraCosts = extraCostsQuery.isLoading;
  const extraCostsError = extraCostsQuery.isError;
  const handleModifyClick = () => {
    if (!entry || !monthRange) return;
    const params = new URLSearchParams({
      trainerId: entry.userId,
      startDate: monthRange.startDate,
      endDate: monthRange.endDate,
    });
    navigate(`/usuarios/costes_extra?${params.toString()}`);
  };

  return (
    <Modal show={Boolean(entry)} onHide={onHide} centered backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          Extras de {entry.fullName} · {monthLabel} {entry.year}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-3">
        {isLoadingDocuments ? (
          <div className="text-muted">Cargando documentos de gasto…</div>
        ) : documentsError ? (
          <Alert variant="warning" className="mb-0">
            No se pudieron cargar los documentos de gasto de este usuario.
          </Alert>
        ) : matchingExpenseDocuments.length ? (
          <Alert variant="info" className="mb-0">
            <div className="fw-semibold">Documentos de gasto del mes</div>
            <ul className="mb-0 ps-3">
              {matchingExpenseDocuments.map((document) => (
                <li key={document.id}>
                  <a href={document.download_url} target="_blank" rel="noreferrer">
                    {document.title ?? document.file_name}
                  </a>
                  {document.document_type_label ? ` · ${document.document_type_label}` : null}
                </li>
              ))}
            </ul>
          </Alert>
        ) : (
          <div className="text-muted small">No hay documentos de gasto para este mes.</div>
        )}
        {isLoadingExtraCosts ? (
          <div className="text-muted">Cargando costes extra…</div>
        ) : extraCostsError ? (
          <Alert variant="warning" className="mb-0">
            No se pudieron cargar los costes extra de este mes.
          </Alert>
        ) : null}
        <Row className="g-3">
          {EXTRAS_SUMMARY_FIELDS.map((field) => (
            <Col key={field.key} md={field.col}>
              <Form.Group controlId={`extras-${field.key}`}>
                <Form.Label>{field.label}</Form.Label>
                <Form.Control
                  type="number"
                  step="0.01"
                  value={allowEdit ? fields[field.key] : extrasTotals[field.key].toFixed(2)}
                  onChange={(event) =>
                    allowEdit
                      ? setFields((prev) => ({
                          ...prev,
                          [field.key]: event.target.value,
                        }))
                      : undefined
                  }
                  readOnly={!allowEdit}
                  disabled={!allowEdit}
                  inputMode="decimal"
                />
              </Form.Group>
            </Col>
          ))}
          <Col md={12}>
            <Form.Group controlId="extras-total">
              <Form.Label>Total Extras</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={allowEdit ? editableTotalExtras : totalExtrasDisplay}
                readOnly
                disabled
              />
            </Form.Group>
          </Col>
        </Row>
        <div className="d-flex justify-content-end gap-2">
          <Button variant="secondary" onClick={onHide} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="outline-primary" onClick={handleModifyClick} disabled={mutation.isPending}>
            Modificar
          </Button>
          {allowEdit ? (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          ) : null}
        </div>
        {mutation.isError ? (
          <Alert variant="danger" className="mb-0">
            No se pudieron guardar los extras. Revisa los datos e inténtalo de nuevo.
          </Alert>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}

function buildUserSummaryFromPayroll(entry: OfficePayrollRecord): UserSummary {
  const [firstName, ...lastNameParts] = entry.fullName.split(' ');
  const lastName = lastNameParts.join(' ').trim();

  return {
    id: entry.userId,
    firstName: firstName ?? entry.fullName,
    lastName: lastName || '',
    email: entry.email ?? '',
    role: entry.role ?? 'Empleado',
    active: true,
    bankAccount: null,
    address: null,
    createdAt: '',
    updatedAt: '',
    trainerId: null,
    trainerFixedContract: null,
    payroll: {
      convenio: entry.convenio ?? entry.defaultConvenio ?? '',
      categoria: entry.categoria ?? entry.defaultCategoria ?? '',
      antiguedad: entry.antiguedad ?? entry.defaultAntiguedad ?? entry.startDate,
      horasSemana: entry.horasSemana ?? entry.defaultHorasSemana ?? 0,
      baseRetencion: entry.baseRetencion ?? entry.defaultBaseRetencion ?? entry.salarioBruto,
      baseRetencionDetalle: entry.baseRetencionDetalle ?? entry.defaultBaseRetencionDetalle,
      salarioBruto: entry.salarioBruto ?? entry.defaultSalarioBruto,
      salarioBrutoTotal: entry.salarioBrutoTotal ?? entry.defaultSalarioBrutoTotal,
      retencion: entry.retencion ?? entry.defaultRetencion,
      aportacionSsIrpf: entry.aportacionSsIrpf ?? entry.defaultAportacionSsIrpf,
      aportacionSsIrpfDetalle: entry.aportacionSsIrpfDetalle ?? entry.defaultAportacionSsIrpfDetalle,
      salarioLimpio: entry.salarioLimpio ?? entry.defaultSalarioLimpio,
      contingenciasComunes: entry.contingenciasComunes ?? entry.defaultContingenciasComunes,
      contingenciasComunesDetalle:
        entry.contingenciasComunesDetalle ?? entry.defaultContingenciasComunesDetalle,
      totalEmpresa: entry.totalEmpresa ?? entry.defaultTotalEmpresa,
    },
  };
}

type PayrollModalProps = {
  entry: OfficePayrollRecord | null;
  onHide: () => void;
  onSaved: (entry: OfficePayrollRecord) => void;
};

const payrollInitialFields = {
  convenio: '',
  categoria: '',
  antiguedad: '',
  horasSemana: '',
  baseRetencion: '',
  baseRetencionDetalle: '',
  salarioBruto: '',
  totalExtras: '',
  salarioBrutoTotal: '',
  retencion: '',
  aportacionSsIrpfDetalle: '',
  aportacionSsIrpf: '',
  salarioLimpio: '',
  contingenciasComunesDetalle: '',
  contingenciasComunes: '',
  totalEmpresa: '',
  dietas: '',
  kilometrajes: '',
  pernocta: '',
  nocturnidad: '',
  festivo: '',
  horasExtras: '',
  otrosGastos: '',
};

type PayrollFieldKey = keyof typeof payrollInitialFields;

function buildPayrollFieldsFromEntry(entry: OfficePayrollRecord): typeof payrollInitialFields {
  const resolveValue = (value: string | number | null | undefined, fallback?: string | number | null) => {
    const raw = value ?? fallback;
    if (raw === null || raw === undefined) return '';
    return typeof raw === 'number' ? raw.toString() : raw;
  };

  return applyPayrollCalculations({
    convenio: resolveValue(entry.convenio, entry.defaultConvenio),
    categoria: resolveValue(entry.categoria, entry.defaultCategoria),
    antiguedad: resolveValue(entry.antiguedad, entry.defaultAntiguedad ?? entry.startDate),
    horasSemana: resolveValue(entry.horasSemana, entry.defaultHorasSemana),
    baseRetencion: resolveValue(entry.baseRetencion, entry.defaultBaseRetencion ?? entry.salarioBruto),
    baseRetencionDetalle: resolveValue(entry.baseRetencionDetalle, entry.defaultBaseRetencionDetalle),
    salarioBruto: resolveValue(entry.salarioBruto, entry.defaultSalarioBruto),
    totalExtras: resolveValue(entry.totalExtras),
    salarioBrutoTotal: resolveValue(entry.salarioBrutoTotal, entry.defaultSalarioBrutoTotal),
    retencion: resolveValue(entry.retencion, entry.defaultRetencion),
    aportacionSsIrpfDetalle: resolveValue(
      entry.aportacionSsIrpfDetalle,
      entry.defaultAportacionSsIrpfDetalle,
    ),
    aportacionSsIrpf: resolveValue(entry.aportacionSsIrpf, entry.defaultAportacionSsIrpf),
    salarioLimpio: resolveValue(entry.salarioLimpio, entry.defaultSalarioLimpio),
    contingenciasComunesDetalle: resolveValue(
      entry.contingenciasComunesDetalle,
      entry.defaultContingenciasComunesDetalle,
    ),
    contingenciasComunes: resolveValue(entry.contingenciasComunes, entry.defaultContingenciasComunes),
    totalEmpresa: resolveValue(entry.totalEmpresa, entry.defaultTotalEmpresa),
    dietas: resolveValue(entry.dietas),
    kilometrajes: resolveValue(entry.kilometrajes),
    pernocta: resolveValue(entry.pernocta),
    nocturnidad: resolveValue(entry.nocturnidad),
    festivo: resolveValue(entry.festivo),
    horasExtras: resolveValue(entry.horasExtras),
    otrosGastos: resolveValue(entry.otrosGastos),
  });
}

function hasPayrollTableMismatch(value: number | null, calculatedValue: string): boolean {
  const tableValue = resolveNumericValue(value);
  const calculated = normalizeNumber(calculatedValue);

  if (tableValue === null && calculated === null) return false;
  if (tableValue === null || calculated === null) return true;
  return Math.abs(tableValue - calculated) > 0.01;
}

function applyPayrollCalculations(fields: typeof payrollInitialFields): typeof payrollInitialFields {
  const baseRetencionMensual = calculateBaseRetencionMonthly(fields);
  const salarioBrutoCalculado = calculateSalarioBruto(baseRetencionMensual, fields.horasSemana);
  const salarioBruto = salarioBrutoCalculado !== null ? salarioBrutoCalculado : normalizeNumber(fields.salarioBruto);
  const extrasTotal = normalizeNumber(fields.totalExtras);
  const dietas = normalizeNumber(fields.dietas);
  const kilometrajes = normalizeNumber(fields.kilometrajes);
  const pernocta = normalizeNumber(fields.pernocta);
  const nocturnidad = normalizeNumber(fields.nocturnidad);
  const festivo = normalizeNumber(fields.festivo);
  const horasExtras = normalizeNumber(fields.horasExtras);
  const otrosGastos = normalizeNumber(fields.otrosGastos);
  const brutoExtrasTotal =
    pernocta === null && nocturnidad === null && festivo === null && horasExtras === null && otrosGastos === null
      ? null
      : (pernocta ?? 0) + (nocturnidad ?? 0) + (festivo ?? 0) + (horasExtras ?? 0) + (otrosGastos ?? 0);
  const salarioBrutoTotal =
    salarioBruto === null && brutoExtrasTotal === null ? null : (salarioBruto ?? 0) + (brutoExtrasTotal ?? 0);
  const retencionPorcentaje = parsePercentageInput(fields.retencion ?? '');

  const aportacionExpression = fields.aportacionSsIrpfDetalle || fields.aportacionSsIrpf;
  const aportacionExpressionIncludesRetention = /retenci[oó]n/i.test(aportacionExpression);
  const aportacionPorcentaje = parseSumExpression(aportacionExpression, (value) => {
    if (/retenci[oó]n/i.test(value)) return retencionPorcentaje ?? 0;
    return parsePercentageInput(value);
  });

  const totalAportacionPorcentaje =
    aportacionPorcentaje === null
      ? null
      : aportacionPorcentaje + (aportacionExpressionIncludesRetention ? 0 : retencionPorcentaje ?? 0);

  const aporteCalculado =
    salarioBrutoTotal !== null && totalAportacionPorcentaje !== null
      ? -(salarioBrutoTotal * totalAportacionPorcentaje)
      : null;

  const contingenciasExpression = fields.contingenciasComunesDetalle || fields.contingenciasComunes;
  const contingenciasPorcentaje = parseSumExpression(contingenciasExpression, parsePercentageInput);
  const contingenciasCalculadas =
    salarioBrutoTotal !== null && contingenciasPorcentaje !== null
      ? salarioBrutoTotal * contingenciasPorcentaje
      : null;

  const contingenciasComunesNumero =
    contingenciasCalculadas !== null ? contingenciasCalculadas : parseLocaleNumber(fields.contingenciasComunes);
  const totalEmpresaCalculado =
    salarioBrutoTotal !== null && contingenciasComunesNumero !== null
      ? salarioBrutoTotal + contingenciasComunesNumero
      : null;

  const salarioLimpioCalculado =
    salarioBrutoTotal !== null && aporteCalculado !== null
      ? salarioBrutoTotal + aporteCalculado + (dietas ?? 0) + (kilometrajes ?? 0)
      : null;

  return {
    ...fields,
    baseRetencion: baseRetencionMensual !== null ? baseRetencionMensual.toFixed(2) : fields.baseRetencion,
    salarioBruto: salarioBrutoCalculado !== null ? salarioBrutoCalculado.toFixed(2) : fields.salarioBruto,
    totalExtras: extrasTotal !== null ? extrasTotal.toFixed(2) : fields.totalExtras,
    salarioBrutoTotal: salarioBrutoTotal !== null ? salarioBrutoTotal.toFixed(2) : fields.salarioBrutoTotal,
    aportacionSsIrpf: aporteCalculado !== null ? aporteCalculado.toFixed(2) : fields.aportacionSsIrpf,
    salarioLimpio: salarioLimpioCalculado !== null ? salarioLimpioCalculado.toFixed(2) : fields.salarioLimpio,
    contingenciasComunes:
      contingenciasCalculadas !== null ? contingenciasCalculadas.toFixed(2) : fields.contingenciasComunes,
    totalEmpresa: totalEmpresaCalculado !== null ? totalEmpresaCalculado.toFixed(2) : fields.totalEmpresa,
  };
}

function PayrollModal({ entry, onHide, onSaved }: PayrollModalProps) {
  const [fields, setFields] = useState<typeof payrollInitialFields>(payrollInitialFields);

  useEffect(() => {
    if (!entry) return;
    setFields(buildPayrollFieldsFromEntry(entry));
  }, [entry]);

  const handleFieldChange = (field: PayrollFieldKey, value: string) => {
    setFields((prev) => applyPayrollCalculations({ ...prev, [field]: value }));
  };

  const mutation = useMutation({
    mutationFn: () =>
      saveOfficePayroll({
        userId: entry?.userId as string,
        year: entry?.year as number,
        month: entry?.month as number,
        convenio: fields.convenio,
        categoria: fields.categoria,
        antiguedad: fields.antiguedad,
        horasSemana: fields.horasSemana,
        baseRetencion: fields.baseRetencion,
        baseRetencionDetalle: fields.baseRetencionDetalle,
        salarioBruto: fields.salarioBruto,
        totalExtras: fields.totalExtras,
        salarioBrutoTotal: fields.salarioBrutoTotal,
        retencion: fields.retencion,
        aportacionSsIrpfDetalle: fields.aportacionSsIrpfDetalle,
        aportacionSsIrpf: fields.aportacionSsIrpf,
        salarioLimpio: fields.salarioLimpio,
        contingenciasComunesDetalle: fields.contingenciasComunesDetalle,
        contingenciasComunes: fields.contingenciasComunes,
        totalEmpresa: fields.totalEmpresa,
      }),
    onSuccess: (saved) => {
      onSaved(saved);
    },
  });

  if (!entry) return null;

  const monthLabel = MONTH_LABELS[entry.month - 1] ?? `${entry.month}`;
  const antiguedadLabel = entry.antiguedad ?? entry.defaultAntiguedad ?? entry.startDate;

  return (
    <Modal show={Boolean(entry)} onHide={onHide} centered size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          Nómina de {entry.fullName} · {monthLabel} {entry.year}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-3">
        <p className="mb-0 text-muted">
          Antigüedad: {antiguedadLabel ?? 'No indicada'} · Usuario: {entry.email ?? 'Sin email'}
        </p>
        <div className="d-grid gap-3">
          <div>
            <div className="text-uppercase text-muted small mb-2">Datos base</div>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="payroll-convenio">
                  <Form.Label>Convenio</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.convenio}
                    onChange={(event) => handleFieldChange('convenio', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="payroll-categoria">
                  <Form.Label>Categoría</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.categoria}
                    onChange={(event) => handleFieldChange('categoria', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-antiguedad">
                  <Form.Label>Antigüedad</Form.Label>
                  <Form.Control
                    type="date"
                    value={fields.antiguedad}
                    onChange={(event) => handleFieldChange('antiguedad', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-horas">
                  <Form.Label>Horas semana</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.horasSemana}
                    onChange={(event) => handleFieldChange('horasSemana', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-base-retencion-detalle">
                  <Form.Label>Base de retención (detalle anual)</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.baseRetencionDetalle}
                    onChange={(event) => handleFieldChange('baseRetencionDetalle', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-base-retencion">
                  <Form.Label>Base de retención (Detalle anual / 12)</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.baseRetencion}
                    onChange={(event) => handleFieldChange('baseRetencion', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-salario-bruto">
                  <Form.Label>Salario bruto</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.salarioBruto}
                    onChange={(event) => handleFieldChange('salarioBruto', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
            </Row>
          </div>

          <div>
            <div className="text-uppercase text-muted small mb-2">Resultados</div>
            <Row className="g-3">
              <Col md={4}>
                <Form.Group controlId="payroll-total-extras">
                  <Form.Label>Total Extras</Form.Label>
                  <Form.Control type="number" step="0.01" value={fields.totalExtras} readOnly disabled />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-salario-bruto-total">
                  <Form.Label>Salario bruto total</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.salarioBrutoTotal}
                    readOnly
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-retencion">
                  <Form.Label>Retención</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.retencion}
                    onChange={(event) => handleFieldChange('retencion', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-aportacion-detalle">
                  <Form.Label>Detalle cotizaciones SS</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.aportacionSsIrpfDetalle}
                    onChange={(event) => handleFieldChange('aportacionSsIrpfDetalle', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-aportacion">
                  <Form.Label>Cotización SS</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.aportacionSsIrpf}
                    onChange={(event) => handleFieldChange('aportacionSsIrpf', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-salario-limpio">
                  <Form.Label>Salario limpio</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.salarioLimpio}
                    onChange={(event) => handleFieldChange('salarioLimpio', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-contingencias-detalle">
                  <Form.Label>Detalle Coste Empresa</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.contingenciasComunesDetalle}
                    onChange={(event) => handleFieldChange('contingenciasComunesDetalle', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-contingencias">
                  <Form.Label>Coste Empresa</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.contingenciasComunes}
                    onChange={(event) => handleFieldChange('contingenciasComunes', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-total-empresa">
                  <Form.Label>Total empresa</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.totalEmpresa}
                    onChange={(event) => handleFieldChange('totalEmpresa', event.target.value)}
                    inputMode="decimal"
                  />
                </Form.Group>
              </Col>
            </Row>
          </div>
        </div>
        <div className="d-flex justify-content-end gap-2">
          <Button variant="secondary" onClick={onHide} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
        {mutation.isError ? (
          <Alert variant="danger" className="mb-0">
            No se pudo guardar la nómina. Revisa los campos e inténtalo de nuevo.
          </Alert>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}

export default function NominasOficinaPage({
  title = 'Nómina Fijos',
  description = 'Listado mensual de nóminas para personal no formador.',
  filterEntries,
  enableSessionsAction = false,
  allowExtrasEdit = true,
}: NominasOficinaPageProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<OfficePayrollRecord | null>(null);
  const [selectedExtrasEntry, setSelectedExtrasEntry] = useState<OfficePayrollRecord | null>(null);
  const [hasInitializedYear, setHasInitializedYear] = useState(false);

  const payrollQuery = useQuery<OfficePayrollResponse>({
    queryKey: ['reporting', 'nominas-oficina', selectedYear],
    queryFn: async () => fetchOfficePayrolls(selectedYear),
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    if (!hasInitializedYear && selectedYear === null && payrollQuery.data?.latestMonth?.year) {
      setSelectedYear(payrollQuery.data.latestMonth.year);
      setHasInitializedYear(true);
    }
  }, [hasInitializedYear, payrollQuery.data, selectedYear]);

  const handleYearChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value ? Number(event.target.value) : null;
    setSelectedYear(value);
    setHasInitializedYear(true);
  };

  const filteredEntries = useMemo(() => {
    const entries = payrollQuery.data?.entries ?? [];
    if (!filterEntries) return entries;
    return entries.filter(filterEntries);
  }, [filterEntries, payrollQuery.data?.entries]);

  const filteredAvailableYears = useMemo(() => {
    if (!filterEntries) {
      return payrollQuery.data?.availableYears ?? [];
    }

    const years = new Set<number>();
    filteredEntries.forEach((entry) => years.add(entry.year));
    return Array.from(years).sort((a, b) => b - a);
  }, [filterEntries, filteredEntries, payrollQuery.data?.availableYears]);

  const groupedByYear = useMemo(() => {
    return filteredEntries.reduce<Record<number, Record<number, OfficePayrollRecord[]>>>((acc, entry) => {
      if (!acc[entry.year]) acc[entry.year] = {};
      if (!acc[entry.year][entry.month]) acc[entry.year][entry.month] = [];
      acc[entry.year][entry.month].push(entry);
      return acc;
    }, {});
  }, [filteredEntries]);

  const sortedYears = useMemo(() => {
    return Object.keys(groupedByYear)
      .map((year) => Number(year))
      .sort((a, b) => b - a);
  }, [groupedByYear]);

  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);

  const userUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateUser>[1] }) =>
      updateUser(id, payload),
    onSuccess: (user) => {
      setEditingUser(user);
      queryClient.invalidateQueries({ queryKey: ['users'] }).catch(() => {});
      queryClient.setQueryData(['user-details', user.id], user);
    },
  });

  const handleUserModalSubmit = async (values: UserFormValues) => {
    if (!editingUser) {
      throw new Error('No hay usuario seleccionado para editar.');
    }

    const normalizedPayload = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      email: values.email.trim(),
      role: values.role,
      active: values.active,
      bankAccount: values.bankAccount.trim(),
      address: values.address.trim(),
      payroll: buildPayrollPayload(values.payroll),
    };

    const updatedUser = await userUpdateMutation.mutateAsync({
      id: editingUser.id,
      payload: {
        ...normalizedPayload,
        bankAccount: normalizedPayload.bankAccount || null,
        address: normalizedPayload.address || null,
      },
    });

    return updatedUser;
  };

  const handleEntrySaved = (entry: OfficePayrollRecord) => {
    setSelectedEntry(null);
    setSelectedExtrasEntry(null);
    queryClient.setQueryData<OfficePayrollResponse | undefined>(
      ['reporting', 'nominas-oficina', selectedYear],
      (previous) => {
        if (!previous) return previous;
        const nextEntries = previous.entries.map((item) =>
          item.userId === entry.userId && item.year === entry.year && item.month === entry.month
            ? entry
            : item,
        );
        const exists = nextEntries.some(
          (item) => item.userId === entry.userId && item.year === entry.year && item.month === entry.month,
        );
        const finalEntries = exists ? nextEntries : [...nextEntries, entry];
        return { ...previous, entries: finalEntries };
      },
    );
  };

  return (
    <div className="d-grid gap-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <h3 className="mb-0">{title}</h3>
          <p className="text-muted mb-0">{description}</p>
        </div>
        <Form.Select
          style={{ maxWidth: '240px' }}
          value={selectedYear ?? ''}
          onChange={handleYearChange}
        >
          <option value="">Todos los años</option>
          {filteredAvailableYears.map((year: number) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Form.Select>
      </div>

      <Alert variant="info" className="mb-0">
        Las nóminas se agrupan por año y mes según la antigüedad indicada en la ficha del usuario. Si un empleado
        comenzó en un mes concreto, solo aparecerá a partir de esa fecha y los cambios guardados no afectarán a los
        meses anteriores.
      </Alert>

      {payrollQuery.isLoading ? (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" className="me-2" /> Cargando nóminas…
        </div>
      ) : payrollQuery.isError ? (
        <Alert variant="danger" className="mb-0">
          No se pudo cargar la información de nóminas de oficina.
        </Alert>
      ) : !sortedYears.length ? (
        <div className="text-center text-muted py-4">No hay nóminas registradas para los filtros seleccionados.</div>
      ) : (
        <Accordion alwaysOpen>
          {sortedYears.map((year) => {
            const months = Object.keys(groupedByYear[year])
              .map((month) => Number(month))
              .sort((a, b) => b - a);
            const yearTotals = calculateTotals(Object.values(groupedByYear[year]).flat());

            return (
              <Accordion.Item eventKey={String(year)} key={year}>
                <Accordion.Header>
                  <div className="d-flex justify-content-between align-items-center w-100 flex-wrap gap-2">
                    <span className="fw-semibold">{year}</span>
                    <div className="d-flex flex-wrap gap-3 text-muted small">
                      <span>Bruto: {formatCurrencyValue(yearTotals.salarioBruto)}</span>
                      <span>Aportación: {formatCurrencyValue(yearTotals.aportacion)}</span>
                      <span>Salario limpio: {formatCurrencyValue(yearTotals.salarioLimpio)}</span>
                      <span>Registros: {yearTotals.count}</span>
                    </div>
                  </div>
                </Accordion.Header>
                <Accordion.Body className="bg-light-subtle">
                  <Accordion alwaysOpen>
                    {months.map((month) => {
                      const items = groupedByYear[year][month];
                      const monthTotals = calculateTotals(items);
                      const monthLabel = MONTH_LABELS[month - 1] ?? `${month}`;

                      return (
                        <Accordion.Item eventKey={`${year}-${month}`} key={`${year}-${month}`}>
                          <Accordion.Header>
                            <div className="d-flex justify-content-between align-items-center w-100 flex-wrap gap-2">
                              <span>
                                {monthLabel} {year}
                              </span>
                              <div className="d-flex flex-wrap gap-3 text-muted small">
                                <span>Bruto: {formatCurrencyValue(monthTotals.salarioBruto)}</span>
                                <span>Aportación: {formatCurrencyValue(monthTotals.aportacion)}</span>
                                <span>Salario limpio: {formatCurrencyValue(monthTotals.salarioLimpio)}</span>
                                <span>Registros: {monthTotals.count}</span>
                              </div>
                            </div>
                          </Accordion.Header>
                          <Accordion.Body>
                            <div className="table-responsive">
                              <Table hover className="align-middle mb-0">
                                <thead>
                                  <tr>
                                    <th>Usuario</th>
                                    <th>Salario bruto</th>
                                    <th>Total Extras</th>
                                    <th>Cotización SS</th>
                                    <th>Salario limpio</th>
                                    <th style={{ width: '140px' }}>Estado</th>
                                    <th style={{ width: '220px' }} className="text-end">
                                      Acciones
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((entry) => {
                                    const modalFields = buildPayrollFieldsFromEntry(entry);
                                    const mismatches = {
                                      salarioBrutoTotal: hasPayrollTableMismatch(
                                        entry.salarioBrutoTotal,
                                        modalFields.salarioBrutoTotal,
                                      ),
                                      totalExtras: hasPayrollTableMismatch(entry.totalExtras, modalFields.totalExtras),
                                      aportacionSsIrpf: hasPayrollTableMismatch(
                                        entry.aportacionSsIrpf,
                                        modalFields.aportacionSsIrpf,
                                      ),
                                      salarioLimpio: hasPayrollTableMismatch(
                                        entry.salarioLimpio,
                                        modalFields.salarioLimpio,
                                      ),
                                    };
                                    const salarioBruto = resolveDisplayValue(entry.salarioBrutoTotal);
                                    const totalExtras = resolveDisplayValue(entry.totalExtras);
                                    const aportacion = resolveDisplayValue(entry.aportacionSsIrpf);
                                    const salarioLimpio = resolveDisplayValue(entry.salarioLimpio);

                                    return (
                                      <tr key={`${year}-${month}-${entry.userId}`}>
                                        <td>
                                          <Button
                                            variant="link"
                                            className="p-0"
                                            onClick={() => setEditingUser(buildUserSummaryFromPayroll(entry))}
                                          >
                                            {entry.fullName}
                                          </Button>
                                          {!entry.isSaved ? (
                                            <Badge bg="warning" text="dark" className="ms-2">
                                              Pendiente
                                            </Badge>
                                          ) : null}
                                        </td>
                                        <td className={mismatches.salarioBrutoTotal ? 'text-danger fw-semibold' : ''}>
                                          {salarioBruto}
                                        </td>
                                        <td className={mismatches.totalExtras ? 'text-danger fw-semibold' : ''}>
                                          {totalExtras}
                                        </td>
                                        <td className={mismatches.aportacionSsIrpf ? 'text-danger fw-semibold' : ''}>
                                          {aportacion}
                                        </td>
                                        <td className={mismatches.salarioLimpio ? 'text-danger fw-semibold' : ''}>
                                          {salarioLimpio}
                                        </td>
                                        <td>{entry.isSaved ? 'Guardada' : 'Sin guardar'}</td>
                                        <td className="text-end">
                                          <div className="d-inline-flex gap-2">
                                            <Button
                                              size="sm"
                                              variant="outline-primary"
                                              onClick={() => setSelectedEntry(entry)}
                                            >
                                              Nómina
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline-secondary"
                                              onClick={() => setSelectedExtrasEntry(entry)}
                                            >
                                              Extras
                                            </Button>
                                            {enableSessionsAction ? (
                                              <Button
                                                size="sm"
                                                variant="outline-success"
                                                onClick={() => {
                                                  const range = buildMonthRange(year, month);
                                                  const params = new URLSearchParams({
                                                    trainerId: entry.userId,
                                                    trainerName: entry.fullName,
                                                    startDate: range.startDate,
                                                    endDate: range.endDate,
                                                  });
                                                  navigate(`/usuarios/costes_extra?${params.toString()}`);
                                                }}
                                              >
                                                Sesiones
                                              </Button>
                                            ) : null}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </Table>
                            </div>
                          </Accordion.Body>
                        </Accordion.Item>
                      );
                    })}
                  </Accordion>
                </Accordion.Body>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <PayrollModal entry={selectedEntry} onHide={() => setSelectedEntry(null)} onSaved={handleEntrySaved} />
      <ExtrasModal
        entry={selectedExtrasEntry}
        onHide={() => setSelectedExtrasEntry(null)}
        onSaved={handleEntrySaved}
        allowEdit={allowExtrasEdit}
      />
      <UserFormModal
        show={Boolean(editingUser)}
        onHide={() => setEditingUser(null)}
        onSubmit={handleUserModalSubmit}
        isSubmitting={userUpdateMutation.isPending}
        initialValue={editingUser}
      />
    </div>
  );
}
