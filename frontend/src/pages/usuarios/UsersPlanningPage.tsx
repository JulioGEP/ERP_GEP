import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, ButtonGroup, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { fetchUsers, type UserSummary } from '../../api/users';
import { exportToExcel } from '../../shared/export/exportToExcel';

type ShiftSlot = 'Mañana' | 'Tarde';
type ShiftType = 'ORDINARIO' | 'ESPECIAL' | 'DOMINGO_LUNES';

type Firefighter = {
  code: string;
  name: string;
  shift: ShiftSlot;
};

type DayPlan = {
  date: Date;
  dayType: ShiftType;
  morningMembers: Firefighter[];
  afternoonMembers: Firefighter[];
  rotatingMorning: Firefighter | null;
  rotatingAfternoon: Firefighter | null;
  hoursPerService: number;
  morningWindow: string;
  afternoonWindow: string;
};

type YearSummaryRow = {
  firefighterCode: string;
  firefighterName: string;
  shift: ShiftSlot;
  totalHours: number;
  totalServices: number;
  status: 'OBJETIVO' | 'CERCA' | 'ALTO';
};

type FirefighterStats = {
  totalHours: number;
  totalServices: number;
  weeklyServices: Map<string, number>;
};

const TARGET_ANNUAL_HOURS = 1986;
const TARGET_MONTHLY_HOURS = 160;
const WEEKLY_MAX_SERVICES = 3;
const SERVICES_PER_SHIFT = 3;
const ORDINARY_SERVICE_HOURS = 12;
const SPECIAL_SERVICE_HOURS = 10;
const CLOSE_THRESHOLD = TARGET_ANNUAL_HOURS * 0.95;
const SUNDAY_MONDAY_SERVICE_HOURS = 12.5;
const SUNDAY_MONDAY_MORNING_WINDOW = '05:45 - 18:15';
const SUNDAY_MONDAY_AFTERNOON_WINDOW = '17:45 - 06:15';

function buildDefaultFirefighters(): Firefighter[] {
  return [
    { code: 'B01', name: '', shift: 'Mañana' },
    { code: 'B02', name: '', shift: 'Mañana' },
    { code: 'B03', name: '', shift: 'Mañana' },
    { code: 'B04', name: '', shift: 'Mañana' },
    { code: 'B05', name: '', shift: 'Mañana' },
    { code: 'B06', name: '', shift: 'Mañana' },
    { code: 'B07', name: '', shift: 'Mañana' },
    { code: 'B08', name: '', shift: 'Tarde' },
    { code: 'B09', name: '', shift: 'Tarde' },
    { code: 'B10', name: '', shift: 'Tarde' },
    { code: 'B11', name: '', shift: 'Tarde' },
    { code: 'B12', name: '', shift: 'Tarde' },
    { code: 'B13', name: '', shift: 'Tarde' },
    { code: 'B14', name: '', shift: 'Tarde' },
  ];
}

function isSpecialDay(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6;
}

function isSundayMondayDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 1;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

function weekKey(date: Date): string {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOffset = Math.floor((date.getTime() - firstDayOfYear.getTime()) / 86400000);
  const week = Math.floor((dayOffset + firstDayOfYear.getDay()) / 7) + 1;
  return `${date.getFullYear()}-W${week}`;
}

function getStatus(totalHours: number): YearSummaryRow['status'] {
  if (totalHours > TARGET_ANNUAL_HOURS) return 'ALTO';
  if (totalHours >= CLOSE_THRESHOLD) return 'CERCA';
  return 'OBJETIVO';
}

function displayName(firefighter: Firefighter): string {
  return firefighter.name.trim() || firefighter.code;
}

export default function UsersPlanningPage() {
  const [firefighters, setFirefighters] = useState<Firefighter[]>(() => buildDefaultFirefighters());
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(new Date().getMonth());

  const trainersQuery = useQuery({
    queryKey: ['users', 'planning', 'active-trainers'],
    queryFn: async () => {
      const response = await fetchUsers({
        includeTrainers: true,
        status: 'active',
        pageSize: 500,
      });
      return response.users.filter((user) => user.role === 'Formador');
    },
  });
  const activeTrainers = trainersQuery.data ?? [];

  const planningModel = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const startDate = new Date(year, now.getMonth(), 1);
    const endDate = new Date(year, 11, 31);

    const shifts = {
      'Mañana': firefighters.filter((firefighter) => firefighter.shift === 'Mañana'),
      Tarde: firefighters.filter((firefighter) => firefighter.shift === 'Tarde'),
    } as const;

    const stats = new Map<string, FirefighterStats>();
    firefighters.forEach((firefighter) => {
      stats.set(firefighter.code, {
        totalHours: 0,
        totalServices: 0,
        weeklyServices: new Map<string, number>(),
      });
    });

    const rotationCursor: Record<ShiftSlot, number> = { Mañana: 0, Tarde: 0 };
    const alerts: string[] = [];
    const days: DayPlan[] = [];

    const pickServiceMembers = (pool: Firefighter[], date: Date, hours: number): Firefighter[] => {
      const key = weekKey(date);
      const eligible = pool.filter((firefighter) => {
        const firefighterStats = stats.get(firefighter.code);
        return (firefighterStats?.weeklyServices.get(key) ?? 0) < WEEKLY_MAX_SERVICES;
      });

      const candidates = (eligible.length >= SERVICES_PER_SHIFT ? eligible : pool)
        .slice()
        .sort((a, b) => {
          const aStats = stats.get(a.code);
          const bStats = stats.get(b.code);
          const aWeekly = aStats?.weeklyServices.get(key) ?? 0;
          const bWeekly = bStats?.weeklyServices.get(key) ?? 0;
          if (aWeekly !== bWeekly) return aWeekly - bWeekly;
          if ((aStats?.totalHours ?? 0) !== (bStats?.totalHours ?? 0)) {
            return (aStats?.totalHours ?? 0) - (bStats?.totalHours ?? 0);
          }
          return a.code.localeCompare(b.code);
        })
        .slice(0, SERVICES_PER_SHIFT);

      if (eligible.length < SERVICES_PER_SHIFT) {
        alerts.push(`Semana ${key}: no hay suficientes bomberos para mantener el tope de ${WEEKLY_MAX_SERVICES} servicios.`);
      }

      candidates.forEach((firefighter) => {
        const firefighterStats = stats.get(firefighter.code);
        if (!firefighterStats) return;
        firefighterStats.totalHours += hours;
        firefighterStats.totalServices += 1;
        const previousWeekly = firefighterStats.weeklyServices.get(key) ?? 0;
        firefighterStats.weeklyServices.set(key, previousWeekly + 1);
      });

      return candidates;
    };

    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
      const date = new Date(cursor);
      const special = isSpecialDay(date);
      const sundayMonday = isSundayMondayDay(date);
      const hours = sundayMonday
        ? SUNDAY_MONDAY_SERVICE_HOURS
        : special
          ? SPECIAL_SERVICE_HOURS
          : ORDINARY_SERVICE_HOURS;
      const morningWindow = sundayMonday ? SUNDAY_MONDAY_MORNING_WINDOW : '—';
      const afternoonWindow = sundayMonday ? SUNDAY_MONDAY_AFTERNOON_WINDOW : '—';

      const morningMembers = pickServiceMembers(shifts.Mañana, date, hours);
      const afternoonMembers = pickServiceMembers(shifts.Tarde, date, hours);

      const rotatingMorning = shifts.Mañana.length
        ? shifts.Mañana[rotationCursor.Mañana % shifts.Mañana.length]
        : null;
      const rotatingAfternoon = shifts.Tarde.length
        ? shifts.Tarde[rotationCursor.Tarde % shifts.Tarde.length]
        : null;

      rotationCursor.Mañana += 1;
      rotationCursor.Tarde += 1;

      days.push({
        date,
        dayType: sundayMonday ? 'DOMINGO_LUNES' : special ? 'ESPECIAL' : 'ORDINARIO',
        morningMembers,
        afternoonMembers,
        rotatingMorning,
        rotatingAfternoon,
        hoursPerService: hours,
        morningWindow,
        afternoonWindow,
      });
    }

    return { days, stats, alerts };
  }, [firefighters]);

  const planningMonths = useMemo(() => {
    const grouped = new Map<number, DayPlan[]>();
    for (const day of planningModel.days) {
      const month = day.date.getMonth();
      const previous = grouped.get(month) ?? [];
      previous.push(day);
      grouped.set(month, previous);
    }
    return grouped;
  }, [planningModel.days]);

  const selectedMonthDays = planningMonths.get(selectedMonthIndex) ?? [];

  const yearlySummary = useMemo<YearSummaryRow[]>(() => {
    return firefighters.map((firefighter) => {
      const firefighterStats = planningModel.stats.get(firefighter.code);
      const totalHours = Number((firefighterStats?.totalHours ?? 0).toFixed(1));
      return {
        firefighterCode: firefighter.code,
        firefighterName: firefighter.name,
        shift: firefighter.shift,
        totalHours,
        totalServices: firefighterStats?.totalServices ?? 0,
        status: getStatus(totalHours),
      };
    });
  }, [firefighters, planningModel.stats]);

  const monthlyBalance = useMemo(() => {
    const monthly = new Map<number, number[]>();
    planningModel.days.forEach((day) => {
      const month = day.date.getMonth();
      const current = monthly.get(month) ?? [];
      const people = [...day.morningMembers, ...day.afternoonMembers];
      current.push(people.length * day.hoursPerService);
      monthly.set(month, current);
    });
    return monthly;
  }, [planningModel.days]);

  const handleNameChange = (code: string, name: string) => {
    setFirefighters((previous) => previous.map((ff) => (ff.code === code ? { ...ff, name } : ff)));
  };

  const handleShiftChange = (code: string, shift: ShiftSlot) => {
    setFirefighters((previous) => previous.map((ff) => (ff.code === code ? { ...ff, shift } : ff)));
  };

  const allFirefightersAssigned = useMemo(
    () => firefighters.every((firefighter) => firefighter.name.trim().length > 0),
    [firefighters],
  );

  const handleDownloadExcel = () => {
    if (!allFirefightersAssigned) return;

    const rows: Array<Array<string | number>> = [
      ['Código', 'Nombre', 'Turno base', 'Horas estimadas', 'Servicios', 'Estado'],
      ...yearlySummary.map((row) => [row.firefighterCode, row.firefighterName, row.shift, row.totalHours, row.totalServices, row.status]),
    ];

    exportToExcel({
      rows,
      fileName: `planificacion-bomberos-${new Date().getFullYear()}.xlsx`,
      sheetName: 'Planificación',
      auditEvent: {
        action: 'users_planning_excel_download',
        entityType: 'planning',
        details: { firefighters: yearlySummary.length },
      },
    });
  };

  const averageAnnualHours = yearlySummary.length
    ? yearlySummary.reduce((acc, firefighter) => acc + firefighter.totalHours, 0) / yearlySummary.length
    : 0;

  return (
    <div className="d-flex flex-column gap-3">
      <Card>
        <Card.Header className="d-flex flex-column gap-1">
          <strong>Planificación anual de turnos</strong>
          <span className="text-muted small">
            Rotación anual sin vacaciones: 14 bomberos (7 mañana / 7 tarde), objetivo de equilibrio en el total anual.
          </span>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-2">
          <Alert variant="info" className="mb-0">
            <strong>Condiciones aplicadas:</strong> máximo {WEEKLY_MAX_SERVICES} servicios semanales por bombero (≈40h),
            {` `}{SERVICES_PER_SHIFT} bomberos por servicio, rotación diaria del 7º bombero de cada turno y turnos de domingo
            y lunes de {SUNDAY_MONDAY_SERVICE_HOURS.toLocaleString('es-ES')}h (05:45-18:15 / 17:45-06:15).
          </Alert>
          <Alert variant="secondary" className="mb-0">
            Calendario base sin vacaciones ({TARGET_ANNUAL_HOURS.toLocaleString('es-ES')} h/año). Las vacaciones se cubrirán posteriormente.
          </Alert>
          {planningModel.alerts.length > 0 && (
            <Alert variant="warning" className="mb-0">
              {planningModel.alerts[0]}
            </Alert>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>1) Configuración de bomberos (14 slots)</strong>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            {firefighters.map((firefighter) => (
              <Col md={6} lg={4} key={firefighter.code}>
                <Card className="h-100 border-light-subtle">
                  <Card.Body className="d-flex flex-column gap-2">
                    <div className="d-flex justify-content-between align-items-center">
                      <strong>{firefighter.code}</strong>
                      <Badge bg={firefighter.shift === 'Mañana' ? 'primary' : 'dark'}>{firefighter.shift}</Badge>
                    </div>
                    <Form.Group>
                      <Form.Label className="small text-muted mb-1">Nombre</Form.Label>
                      <Form.Select
                        value={firefighter.name}
                        onChange={(event) => handleNameChange(firefighter.code, event.target.value)}
                      >
                        <option value="">Selecciona formador activo</option>
                        {activeTrainers.map((trainer: UserSummary) => {
                          const fullName = `${trainer.firstName} ${trainer.lastName}`.trim();
                          return (
                            <option key={trainer.id} value={fullName}>
                              {fullName}
                            </option>
                          );
                        })}
                      </Form.Select>
                    </Form.Group>
                    <Form.Group>
                      <Form.Label className="small text-muted mb-1">Turno base</Form.Label>
                      <Form.Select
                        value={firefighter.shift}
                        onChange={(event) => handleShiftChange(firefighter.code, event.target.value as ShiftSlot)}
                      >
                        <option value="Mañana">Mañana</option>
                        <option value="Tarde">Tarde</option>
                      </Form.Select>
                    </Form.Group>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header className="d-flex flex-wrap gap-2 justify-content-between align-items-center">
          <strong>2) Planificación mensual</strong>
          <ButtonGroup size="sm">
            {Array.from(planningMonths.keys()).map((month) => {
              const firstDay = planningMonths.get(month)?.[0]?.date;
              if (!firstDay) return null;
              return (
                <Button
                  key={month}
                  variant={selectedMonthIndex === month ? 'primary' : 'outline-primary'}
                  onClick={() => setSelectedMonthIndex(month)}
                >
                  {formatMonthYear(firstDay)}
                </Button>
              );
            })}
          </ButtonGroup>
        </Card.Header>
        <Card.Body className="table-responsive">
          <Table size="sm" hover>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Turno mañana</th>
                <th>Turno tarde</th>
              </tr>
            </thead>
            <tbody>
              {selectedMonthDays.map((day) => (
                <tr key={day.date.toISOString()}>
                  <td>{formatDate(day.date)}</td>
                  <td>
                    <Badge
                      bg={day.dayType === 'ESPECIAL' ? 'warning' : day.dayType === 'DOMINGO_LUNES' ? 'primary' : 'info'}
                      text={day.dayType === 'ESPECIAL' ? 'dark' : undefined}
                    >
                      {day.dayType}
                    </Badge>
                  </td>
                  <td>
                    <strong>Servicio:</strong> {day.morningMembers.map(displayName).join(', ')} · {day.hoursPerService}h
                    {day.dayType === 'DOMINGO_LUNES' && (
                      <>
                        <br />
                        <span className="text-muted small">Horario: {day.morningWindow}</span>
                      </>
                    )}
                    <br />
                    <span className="text-muted small">Rotación 7º: {day.rotatingMorning ? displayName(day.rotatingMorning) : '—'}</span>
                  </td>
                  <td>
                    <strong>Servicio:</strong> {day.afternoonMembers.map(displayName).join(', ')} · {day.hoursPerService}h
                    {day.dayType === 'DOMINGO_LUNES' && (
                      <>
                        <br />
                        <span className="text-muted small">Horario: {day.afternoonWindow}</span>
                      </>
                    )}
                    <br />
                    <span className="text-muted small">Rotación 7º: {day.rotatingAfternoon ? displayName(day.rotatingAfternoon) : '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>3) Vista anual resumida</strong>
        </Card.Header>
        <Card.Body className="d-flex flex-wrap gap-2">
          {Array.from(planningMonths.entries()).map(([month, days]) => {
            const firstDate = days[0]?.date;
            const ordinary = days.filter((day) => day.dayType === 'ORDINARIO').length;
            const special = days.filter((day) => day.dayType === 'ESPECIAL').length;
            const monthHours = (monthlyBalance.get(month) ?? []).reduce((acc, value) => acc + value, 0);
            if (!firstDate) return null;
            return (
              <Card
                key={month}
                className={`p-2 ${selectedMonthIndex === month ? 'border-primary' : 'border-light-subtle'}`}
                style={{ minWidth: 220 }}
              >
                <div className="fw-semibold text-capitalize">{formatMonthYear(firstDate)}</div>
                <div className="small text-muted">Ordinarios: {ordinary}</div>
                <div className="small text-muted">Especiales: {special}</div>
                <div className="small text-muted">Días planificados: {days.length}</div>
                <div className="small text-muted">
                  Carga total: {monthHours.toLocaleString('es-ES')} h (objetivo individual ≈ {TARGET_MONTHLY_HOURS} h)
                </div>
              </Card>
            );
          })}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>
            4) Resumen por bombero (objetivo {TARGET_ANNUAL_HOURS.toLocaleString('es-ES')} h, promedio actual{' '}
            {averageAnnualHours.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h)
          </strong>
        </Card.Header>
        <Card.Body className="table-responsive">
          <Table size="sm" hover>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Turno</th>
                <th>Horas estimadas</th>
                <th>Servicios</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {yearlySummary.map((row) => (
                <tr key={row.firefighterCode}>
                  <td>{row.firefighterCode}</td>
                  <td>{row.firefighterName}</td>
                  <td>{row.shift}</td>
                  <td>{row.totalHours.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                  <td>{row.totalServices}</td>
                  <td>
                    <Badge bg={row.status === 'ALTO' ? 'danger' : row.status === 'CERCA' ? 'warning' : 'success'} text={row.status === 'CERCA' ? 'dark' : undefined}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="d-flex justify-content-end mt-3">
            <Button variant="success" onClick={handleDownloadExcel} disabled={!allFirefightersAssigned}>
              Descargar Excel
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>5) Lógicas aplicadas en la planificación</strong>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <h6 className="mb-1">Equilibrio de carga y prioridad de asignación</h6>
            <p className="mb-0 text-muted">
              Cada día se asignan 3 bomberos por turno. El sistema prioriza primero a quienes tienen menos servicios en la semana y, en
              caso de empate, a quienes acumulan menos horas totales en el año para repartir la carga de forma homogénea.
            </p>
          </div>
          <div>
            <h6 className="mb-1">Control de límites semanales</h6>
            <p className="mb-0 text-muted">
              Se aplica un máximo de {WEEKLY_MAX_SERVICES} servicios por semana y bombero. Si en una semana no hay suficientes perfiles
              elegibles para cubrir el servicio, se mantiene la cobertura mínima y se notifica una alerta de capacidad.
            </p>
          </div>
          <div>
            <h6 className="mb-1">Tipos de día y cómputo de horas</h6>
            <p className="mb-0 text-muted">
              Los días ordinarios computan {ORDINARY_SERVICE_HOURS} horas por servicio, los especiales (viernes y sábado)
              computan {SPECIAL_SERVICE_HOURS} horas y los turnos de domingo/lunes computan
              {` `}{SUNDAY_MONDAY_SERVICE_HOURS.toLocaleString('es-ES')} horas con horario 05:45-18:15 (mañana) y
              17:45-06:15 (tarde). Este ajuste permite estimar el impacto real mensual y anual de la planificación.
            </p>
          </div>
          <div>
            <h6 className="mb-1">Rotación estructural del 7º bombero</h6>
            <p className="mb-0 text-muted">
              De forma paralela a los 3 asignados por servicio, se muestra una rotación diaria del 7º bombero por turno para garantizar
              visibilidad de relevo y facilitar la posterior incorporación de vacaciones o incidencias.
            </p>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
