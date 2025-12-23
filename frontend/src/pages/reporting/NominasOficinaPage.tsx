import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accordion, Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import {
  fetchOfficePayrolls,
  saveOfficePayroll,
  type OfficePayrollRecord,
  type OfficePayrollResponse,
} from '../../features/reporting/api';
import { type UserSummary, updateUser } from '../../api/users';
import { UserFormModal, buildPayrollPayload, type UserFormValues } from '../usuarios/UsersPage';
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

function PayrollModal({ entry, onHide, onSaved }: PayrollModalProps) {
  const initialFields = {
    convenio: '',
    categoria: '',
    antiguedad: '',
    horasSemana: '',
    baseRetencion: '',
    baseRetencionDetalle: '',
    salarioBruto: '',
    salarioBrutoTotal: '',
    retencion: '',
    aportacionSsIrpfDetalle: '',
    aportacionSsIrpf: '',
    salarioLimpio: '',
    contingenciasComunesDetalle: '',
    contingenciasComunes: '',
    totalEmpresa: '',
  };

  type PayrollFieldKey = keyof typeof initialFields;

  const [fields, setFields] = useState<typeof initialFields>(initialFields);

  useEffect(() => {
    if (!entry) return;
    const resolveValue = (value: string | number | null | undefined, fallback?: string | number | null) => {
      const raw = value ?? fallback;
      if (raw === null || raw === undefined) return '';
      return typeof raw === 'number' ? raw.toString() : raw;
    };

    setFields({
      convenio: resolveValue(entry.convenio, entry.defaultConvenio),
      categoria: resolveValue(entry.categoria, entry.defaultCategoria),
      antiguedad: resolveValue(entry.antiguedad, entry.defaultAntiguedad ?? entry.startDate),
      horasSemana: resolveValue(entry.horasSemana, entry.defaultHorasSemana),
      baseRetencion: resolveValue(entry.baseRetencion, entry.defaultBaseRetencion ?? entry.salarioBruto),
      baseRetencionDetalle: resolveValue(entry.baseRetencionDetalle, entry.defaultBaseRetencionDetalle),
      salarioBruto: resolveValue(entry.salarioBruto, entry.defaultSalarioBruto),
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
    });
  }, [entry]);

  const handleFieldChange = (field: PayrollFieldKey, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }));
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
                <Form.Group controlId="payroll-salario-bruto-total">
                  <Form.Label>Salario bruto total</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={fields.salarioBrutoTotal}
                    onChange={(event) => handleFieldChange('salarioBrutoTotal', event.target.value)}
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

  const payrollQuery = useQuery<OfficePayrollResponse>({
    queryKey: ['reporting', 'nominas-oficina', selectedYear],
    queryFn: async () => fetchOfficePayrolls(selectedYear),
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    if (selectedYear === null && payrollQuery.data?.latestMonth?.year) {
      setSelectedYear(payrollQuery.data.latestMonth.year);
    }
  }, [payrollQuery.data, selectedYear]);

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
          <h3 className="mb-0">Nóminas Oficina</h3>
          <p className="text-muted mb-0">Listado mensual de nóminas para personal no formador.</p>
        </div>
        <Form.Select
          style={{ maxWidth: '240px' }}
          value={selectedYear ?? ''}
          onChange={(event) => setSelectedYear(event.target.value ? Number(event.target.value) : null)}
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
                                    <th>Categoría</th>
                                    <th>Salario bruto</th>
                                    <th>Aportación SS e IRPF</th>
                                    <th>Salario limpio</th>
                                    <th style={{ width: '140px' }}>Estado</th>
                                    <th style={{ width: '160px' }} className="text-end">
                                      Acciones
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((entry) => {
                                    const categoria = resolveDisplayValue(entry.categoria, entry.defaultCategoria);
                                    const salarioBruto = resolveDisplayValue(entry.salarioBruto, entry.defaultSalarioBruto);
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
                                        <td>{categoria}</td>
                                        <td>{salarioBruto}</td>
                                        <td>{aportacion}</td>
                                        <td>{salarioLimpio}</td>
                                        <td>{entry.isSaved ? 'Guardada' : 'Sin guardar'}</td>
                                        <td className="text-end">
                                          <Button size="sm" variant="outline-primary" onClick={() => setSelectedEntry(entry)}>
                                            Editar nómina
                                          </Button>
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
