import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from 'react-bootstrap';
import {
  fetchOfficePayrolls,
  saveOfficePayroll,
  type OfficePayrollRecord,
  type OfficePayrollResponse,
} from '../../features/reporting/api';
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

type PayrollModalProps = {
  entry: OfficePayrollRecord | null;
  onHide: () => void;
  onSaved: (entry: OfficePayrollRecord) => void;
};

function PayrollModal({ entry, onHide, onSaved }: PayrollModalProps) {
  const [categoria, setCategoria] = useState('');
  const [salarioBruto, setSalarioBruto] = useState('');
  const [aportacionSsIrpf, setAportacionSsIrpf] = useState('');
  const [salarioLimpio, setSalarioLimpio] = useState('');

  useEffect(() => {
    if (!entry) return;
    setCategoria(entry.categoria ?? entry.defaultCategoria ?? '');
    setSalarioBruto(
      entry.salarioBruto !== null && entry.salarioBruto !== undefined
        ? entry.salarioBruto.toString()
        : entry.defaultSalarioBruto?.toString() ?? '',
    );
    setAportacionSsIrpf(
      entry.aportacionSsIrpf !== null && entry.aportacionSsIrpf !== undefined
        ? entry.aportacionSsIrpf.toString()
        : entry.defaultAportacionSsIrpf?.toString() ?? '',
    );
    setSalarioLimpio(
      entry.salarioLimpio !== null && entry.salarioLimpio !== undefined
        ? entry.salarioLimpio.toString()
        : entry.defaultSalarioLimpio?.toString() ?? '',
    );
  }, [entry]);

  const mutation = useMutation({
    mutationFn: () =>
      saveOfficePayroll({
        userId: entry?.userId as string,
        year: entry?.year as number,
        month: entry?.month as number,
        categoria,
        salarioBruto,
        aportacionSsIrpf,
        salarioLimpio,
      }),
    onSuccess: (saved) => {
      onSaved(saved);
    },
  });

  if (!entry) return null;

  const monthLabel = MONTH_LABELS[entry.month - 1] ?? `${entry.month}`;

  return (
    <Modal show={Boolean(entry)} onHide={onHide} centered size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          Nómina de {entry.fullName} · {monthLabel} {entry.year}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-3">
        <p className="mb-0 text-muted">
          Antigüedad: {entry.startDate ? entry.startDate : 'No indicada'} · Usuario: {entry.email ?? 'Sin email'}
        </p>
        <Row className="g-3">
          <Col md={6}>
            <Form.Group controlId="payroll-categoria">
              <Form.Label>Categoría</Form.Label>
              <Form.Control
                type="text"
                value={categoria}
                onChange={(event) => setCategoria(event.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="payroll-salario-bruto">
              <Form.Label>Salario bruto</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={salarioBruto}
                onChange={(event) => setSalarioBruto(event.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="payroll-aportacion">
              <Form.Label>Aportación SS e IRPF</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={aportacionSsIrpf}
                onChange={(event) => setAportacionSsIrpf(event.target.value)}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group controlId="payroll-salario-limpio">
              <Form.Label>Salario limpio</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={salarioLimpio}
                onChange={(event) => setSalarioLimpio(event.target.value)}
              />
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
            No se pudo guardar la nómina. Revisa los campos e inténtalo de nuevo.
          </Alert>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}

function groupByPeriod(entries: OfficePayrollRecord[]) {
  return entries.reduce<Record<string, { year: number; month: number; items: OfficePayrollRecord[] }>>(
    (acc, entry) => {
      const key = `${entry.year}-${entry.month}`;
      if (!acc[key]) {
        acc[key] = { year: entry.year, month: entry.month, items: [] };
      }
      acc[key].items.push(entry);
      return acc;
    },
    {},
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

  const periodGroups = useMemo(() => {
    return groupByPeriod(payrollQuery.data?.entries ?? []);
  }, [payrollQuery.data?.entries]);

  const sortedPeriods = useMemo(() => {
    return Object.values(periodGroups).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }, [periodGroups]);

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

  const renderTableBody = () => {
    if (payrollQuery.isLoading) {
      return (
        <tr>
          <td colSpan={8} className="text-center py-4">
            <Spinner animation="border" size="sm" className="me-2" /> Cargando nóminas…
          </td>
        </tr>
      );
    }

    if (payrollQuery.isError) {
      return (
        <tr>
          <td colSpan={8}>
            <Alert variant="danger" className="mb-0">
              No se pudo cargar la información de nóminas de oficina.
            </Alert>
          </td>
        </tr>
      );
    }

    if (!sortedPeriods.length) {
      return (
        <tr>
          <td colSpan={8} className="text-center text-muted py-4">
            No hay nóminas registradas para los filtros seleccionados.
          </td>
        </tr>
      );
    }

    return sortedPeriods.flatMap(({ year, month, items }) => {
      const monthLabel = MONTH_LABELS[month - 1] ?? `${month}`;
      return items.map((entry) => {
        const categoria = resolveDisplayValue(entry.categoria, entry.defaultCategoria);
        const salarioBruto = resolveDisplayValue(entry.salarioBruto, entry.defaultSalarioBruto);
        const aportacion = resolveDisplayValue(entry.aportacionSsIrpf, entry.defaultAportacionSsIrpf);
        const salarioLimpio = resolveDisplayValue(entry.salarioLimpio, entry.defaultSalarioLimpio);

        return (
          <tr key={`${year}-${month}-${entry.userId}`}>
            <td>{year}</td>
            <td>{monthLabel}</td>
            <td>
              <Button variant="link" className="p-0" onClick={() => setSelectedEntry(entry)}>
                {entry.fullName}
              </Button>
              {!entry.isSaved ? <Badge bg="warning" text="dark" className="ms-2">Pendiente</Badge> : null}
            </td>
            <td>
              <Button variant="link" className="p-0" onClick={() => setSelectedEntry(entry)}>
                {categoria}
              </Button>
            </td>
            <td>
              <Button variant="link" className="p-0" onClick={() => setSelectedEntry(entry)}>
                {salarioBruto}
              </Button>
            </td>
            <td>
              <Button variant="link" className="p-0" onClick={() => setSelectedEntry(entry)}>
                {aportacion}
              </Button>
            </td>
            <td>
              <Button variant="link" className="p-0" onClick={() => setSelectedEntry(entry)}>
                {salarioLimpio}
              </Button>
            </td>
            <td>{entry.isSaved ? 'Guardada' : 'Sin guardar'}</td>
          </tr>
        );
      });
    });
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

      <div className="table-responsive">
        <Table hover className="align-middle mb-0">
          <thead>
            <tr>
              <th style={{ width: '90px' }}>Año</th>
              <th style={{ width: '120px' }}>Mes</th>
              <th>Usuario</th>
              <th>Categoría</th>
              <th>Salario bruto</th>
              <th>Aportación SS e IRPF</th>
              <th>Salario limpio</th>
              <th style={{ width: '140px' }}>Estado</th>
            </tr>
          </thead>
          <tbody>{renderTableBody()}</tbody>
        </Table>
      </div>

      <PayrollModal entry={selectedEntry} onHide={() => setSelectedEntry(null)} onSaved={handleEntrySaved} />
    </div>
  );
}
