import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accordion, Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import {
  fetchOfficePayrolls,
  saveOfficePayroll,
  type OfficePayrollRecord,
  type OfficePayrollResponse,
} from '../../features/reporting/api';
import { type UserSummary, updateUser } from '../../api/users';
import { fetchUserDocuments, type UserDocument } from '../../api/userDocuments';
import { UserFormModal, buildPayrollPayload, type UserFormValues } from '../usuarios/UsersPage';

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
      const salarioBruto = resolveNumericValue(entry.salarioBruto, entry.defaultSalarioBruto);
      const aportacion = resolveNumericValue(entry.aportacionSsIrpf, entry.defaultAportacionSsIrpf);
      const salarioLimpio = resolveNumericValue(entry.salarioLimpio, entry.defaultSalarioLimpio);

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
};

const extrasInitialFields = {
  dietas: '',
  kilometrajes: '',
  pernocta: '',
  nocturnidad: '',
  festivo: '',
  horasExtras: '',
  otrosGastos: '',
};

type ExtrasFieldKey = keyof typeof extrasInitialFields;

function calculateExtrasTotal(fields: Record<ExtrasFieldKey, string>): number | null {
  const values = [
    fields.dietas,
    fields.kilometrajes,
    fields.pernocta,
    fields.nocturnidad,
    fields.festivo,
    fields.horasExtras,
    fields.otrosGastos,
  ]
    .map((value) => parseLocaleNumber(value))
    .filter((value): value is number => value !== null);

  if (!values.length) return null;

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number(total.toFixed(2));
}

function ExtrasModal({ entry, onHide, onSaved }: ExtrasModalProps) {
  const [fields, setFields] = useState<typeof extrasInitialFields>(extrasInitialFields);

  const {
    data: documents = [],
    isLoading: isLoadingDocuments,
    error: documentsError,
  } = useQuery<UserDocument[]>({
    queryKey: ['user-documents', entry?.userId],
    queryFn: () => fetchUserDocuments(entry?.userId as string),
    enabled: Boolean(entry?.userId),
  });

  useEffect(() => {
    if (!entry) {
      setFields(extrasInitialFields);
      return;
    }

    const resolveValue = (value: number | null | undefined) => {
      if (value === null || value === undefined) return '';
      return value.toString();
    };

    setFields({
      dietas: resolveValue(entry.dietas),
      kilometrajes: resolveValue(entry.kilometrajes),
      pernocta: resolveValue(entry.pernocta),
      nocturnidad: resolveValue(entry.nocturnidad),
      festivo: resolveValue(entry.festivo),
      horasExtras: resolveValue(entry.horasExtras),
      otrosGastos: resolveValue(entry.otrosGastos),
    });
  }, [entry]);

  const totalExtras = useMemo(() => calculateExtrasTotal(fields), [fields]);

  const matchingExpenseDocuments = useMemo(() => {
    if (!entry || !documents?.length) return [];

    return documents.filter((document) => {
      if (document.document_type !== 'gasto') return false;
      if (!document.created_at) return false;

      const createdAt = new Date(document.created_at);
      if (Number.isNaN(createdAt.getTime())) return false;

      return (
        createdAt.getUTCFullYear() === entry.year &&
        createdAt.getUTCMonth() + 1 === entry.month
      );
    });
  }, [documents, entry]);

  const handleFieldChange = (field: ExtrasFieldKey, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }));
  };

  const mutation = useMutation({
    mutationFn: () => {
      const normalizeExtrasNumber = (value: string) => parseLocaleNumber(value);

      return saveOfficePayroll({
        userId: entry?.userId as string,
        year: entry?.year as number,
        month: entry?.month as number,
        dietas: normalizeExtrasNumber(fields.dietas),
        kilometrajes: normalizeExtrasNumber(fields.kilometrajes),
        pernocta: normalizeExtrasNumber(fields.pernocta),
        nocturnidad: normalizeExtrasNumber(fields.nocturnidad),
        festivo: normalizeExtrasNumber(fields.festivo),
        horasExtras: normalizeExtrasNumber(fields.horasExtras),
        otrosGastos: normalizeExtrasNumber(fields.otrosGastos),
        totalExtras,
      });
    },
    onSuccess: (saved) => {
      onSaved(saved);
      onHide();
    },
  });

  if (!entry) return null;

  const totalExtrasDisplay = totalExtras === null ? '' : totalExtras.toFixed(2);
  const monthLabel = MONTH_LABELS[entry.month - 1] ?? `${entry.month}`;

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
        <Row className="g-3">
          <Col md={6}>
            <Form.Group controlId="extras-dietas">
              <Form.Label>Dietas</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.dietas}
                onChange={(event) => handleFieldChange('dietas', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="extras-kilometrajes">
              <Form.Label>Kilometrajes</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.kilometrajes}
                onChange={(event) => handleFieldChange('kilometrajes', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="extras-pernocta">
              <Form.Label>Pernocta</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.pernocta}
                onChange={(event) => handleFieldChange('pernocta', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="extras-nocturnidad">
              <Form.Label>Nocturnidad</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.nocturnidad}
                onChange={(event) => handleFieldChange('nocturnidad', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="extras-festivo">
              <Form.Label>Festivo</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.festivo}
                onChange={(event) => handleFieldChange('festivo', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="extras-horas-extras">
              <Form.Label>Horas extras</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.horasExtras}
                onChange={(event) => handleFieldChange('horasExtras', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group controlId="extras-otros-gastos">
              <Form.Label>Otros gastos</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={fields.otrosGastos}
                onChange={(event) => handleFieldChange('otrosGastos', event.target.value)}
                inputMode="decimal"
              />
            </Form.Group>
          </Col>
          <Col md={12}>
            <Form.Group controlId="extras-total">
              <Form.Label>Total Extras</Form.Label>
              <Form.Control type="number" step="0.01" value={totalExtrasDisplay} readOnly disabled />
            </Form.Group>
          </Col>
        </Row>
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
            No se pudieron guardar los extras. Revisa los campos e inténtalo de nuevo.
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
};

type PayrollFieldKey = keyof typeof payrollInitialFields;

function applyPayrollCalculations(fields: typeof payrollInitialFields): typeof payrollInitialFields {
  const baseRetencionMensual = calculateBaseRetencionMonthly(fields);
  const salarioBrutoCalculado = calculateSalarioBruto(baseRetencionMensual, fields.horasSemana);
  const salarioBruto = salarioBrutoCalculado !== null ? salarioBrutoCalculado : normalizeNumber(fields.salarioBruto);
  const extrasTotal = normalizeNumber(fields.totalExtras);
  const salarioBrutoTotal =
    salarioBruto === null && extrasTotal === null ? null : (salarioBruto ?? 0) + (extrasTotal ?? 0);
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
    salarioBrutoTotal !== null && aporteCalculado !== null ? salarioBrutoTotal + aporteCalculado : null;

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
    const resolveValue = (value: string | number | null | undefined, fallback?: string | number | null) => {
      const raw = value ?? fallback;
      if (raw === null || raw === undefined) return '';
      return typeof raw === 'number' ? raw.toString() : raw;
    };

    setFields(
      applyPayrollCalculations({
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
      }),
    );
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
                  <Form.Label>Detalle aportación SS e IRPF</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.aportacionSsIrpfDetalle}
                    onChange={(event) => handleFieldChange('aportacionSsIrpfDetalle', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-aportacion">
                  <Form.Label>Aportación SS e IRPF</Form.Label>
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
                  <Form.Label>Detalle contingencias comunes</Form.Label>
                  <Form.Control
                    type="text"
                    value={fields.contingenciasComunesDetalle}
                    onChange={(event) => handleFieldChange('contingenciasComunesDetalle', event.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="payroll-contingencias">
                  <Form.Label>Contingencias comunes</Form.Label>
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

export default function NominasOficinaPage() {
  const queryClient = useQueryClient();
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

  const groupedByYear = useMemo(() => {
    const entries = payrollQuery.data?.entries ?? [];
    return entries.reduce<Record<number, Record<number, OfficePayrollRecord[]>>>((acc, entry) => {
      if (!acc[entry.year]) acc[entry.year] = {};
      if (!acc[entry.year][entry.month]) acc[entry.year][entry.month] = [];
      acc[entry.year][entry.month].push(entry);
      return acc;
    }, {});
  }, [payrollQuery.data?.entries]);

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
          <h3 className="mb-0">Nómina Fijos</h3>
          <p className="text-muted mb-0">Listado mensual de nóminas para personal no formador.</p>
        </div>
        <Form.Select
          style={{ maxWidth: '240px' }}
          value={selectedYear ?? ''}
          onChange={handleYearChange}
        >
          <option value="">Todos los años</option>
          {(payrollQuery.data?.availableYears ?? []).map((year: number) => (
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
                                    <th>Aportación SS e IRPF</th>
                                    <th>Salario limpio</th>
                                    <th style={{ width: '140px' }}>Estado</th>
                                    <th style={{ width: '220px' }} className="text-end">
                                      Acciones
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((entry) => {
                                    const salarioBruto = resolveDisplayValue(entry.salarioBruto, entry.defaultSalarioBruto);
                                    const totalExtras = resolveDisplayValue(entry.totalExtras);
                                    const aportacion = resolveDisplayValue(
                                      entry.aportacionSsIrpf,
                                      entry.defaultAportacionSsIrpf,
                                    );
                                    const salarioLimpio = resolveDisplayValue(
                                      entry.salarioLimpio,
                                      entry.defaultSalarioLimpio,
                                    );

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
                                        <td>{salarioBruto}</td>
                                        <td>{totalExtras}</td>
                                        <td>{aportacion}</td>
                                        <td>{salarioLimpio}</td>
                                        <td>{entry.isSaved ? 'Guardada' : 'Sin guardar'}</td>
                                        <td className="text-end">
                                          <div className="d-inline-flex gap-2">
                                            <Button
                                              size="sm"
                                              variant="outline-primary"
                                              onClick={() => setSelectedEntry(entry)}
                                            >
                                              Editar nómina
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline-secondary"
                                              onClick={() => setSelectedExtrasEntry(entry)}
                                            >
                                              Extras
                                            </Button>
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
