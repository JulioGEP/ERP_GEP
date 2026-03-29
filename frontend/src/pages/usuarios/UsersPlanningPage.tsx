import { useMemo, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Card, Col, Form, Row, Table } from 'react-bootstrap';

type TeamCode = 'A' | 'B' | 'C' | 'D' | 'AP';
type ShiftType = 'ORDINARIO' | 'ESPECIAL';
type ShiftSlot = 'Mañana' | 'Noche';

type Firefighter = {
  code: string;
  name: string;
  team: TeamCode;
};

type DayPlan = {
  date: Date;
  dayType: ShiftType;
  morningTeam: TeamCode;
  nightTeam: TeamCode;
  hoursPerShift: number;
};

type YearSummaryRow = {
  firefighterCode: string;
  firefighterName: string;
  team: TeamCode;
  totalHours: number;
  status: 'OK' | 'ALTO' | 'SOBRECARGA';
};

const TARGET_ANNUAL_HOURS = 1794;
const HIGH_THRESHOLD = TARGET_ANNUAL_HOURS * 0.95;
const ORDINARY_SHIFT_HOURS = 12.5;
const SPECIAL_SHIFT_HOURS = 8.5;
const SHIFT_CYCLE: ReadonlyArray<{ morning: TeamCode; night: TeamCode }> = [
  { morning: 'A', night: 'B' },
  { morning: 'C', night: 'D' },
  { morning: 'B', night: 'A' },
  { morning: 'D', night: 'C' },
];

function buildDefaultFirefighters(): Firefighter[] {
  return [
    { code: 'B01', name: 'Bombero 01', team: 'A' },
    { code: 'B02', name: 'Bombero 02', team: 'A' },
    { code: 'B03', name: 'Bombero 03', team: 'A' },
    { code: 'B04', name: 'Bombero 04', team: 'B' },
    { code: 'B05', name: 'Bombero 05', team: 'B' },
    { code: 'B06', name: 'Bombero 06', team: 'B' },
    { code: 'B07', name: 'Bombero 07', team: 'C' },
    { code: 'B08', name: 'Bombero 08', team: 'C' },
    { code: 'B09', name: 'Bombero 09', team: 'C' },
    { code: 'B10', name: 'Bombero 10', team: 'D' },
    { code: 'B11', name: 'Bombero 11', team: 'D' },
    { code: 'B12', name: 'Bombero 12', team: 'D' },
    { code: 'B13', name: 'Bombero 13', team: 'AP' },
    { code: 'B14', name: 'Bombero 14', team: 'AP' },
  ];
}

function isSpecialDay(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6;
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

function getStatus(totalHours: number): YearSummaryRow['status'] {
  if (totalHours > TARGET_ANNUAL_HOURS) return 'SOBRECARGA';
  if (totalHours >= HIGH_THRESHOLD) return 'ALTO';
  return 'OK';
}

export default function UsersPlanningPage() {
  const [firefighters, setFirefighters] = useState<Firefighter[]>(() => buildDefaultFirefighters());
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(new Date().getMonth());

  const planningDays = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const startDate = new Date(year, now.getMonth(), 1);
    const endDate = new Date(year, 11, 31);

    const days: DayPlan[] = [];
    let cycleIndex = 0;

    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
      const shiftPattern = SHIFT_CYCLE[cycleIndex % SHIFT_CYCLE.length];
      const special = isSpecialDay(cursor);

      days.push({
        date: new Date(cursor),
        dayType: special ? 'ESPECIAL' : 'ORDINARIO',
        morningTeam: shiftPattern.morning,
        nightTeam: shiftPattern.night,
        hoursPerShift: special ? SPECIAL_SHIFT_HOURS : ORDINARY_SHIFT_HOURS,
      });

      cycleIndex += 1;
    }

    return days;
  }, []);

  const planningMonths = useMemo(() => {
    const grouped = new Map<number, DayPlan[]>();

    for (const day of planningDays) {
      const month = day.date.getMonth();
      const previous = grouped.get(month) ?? [];
      previous.push(day);
      grouped.set(month, previous);
    }

    return grouped;
  }, [planningDays]);

  const selectedMonthDays = planningMonths.get(selectedMonthIndex) ?? [];

  const firefightersByTeam = useMemo(() => {
    const byTeam = new Map<TeamCode, Firefighter[]>();
    for (const firefighter of firefighters) {
      const bucket = byTeam.get(firefighter.team) ?? [];
      bucket.push(firefighter);
      byTeam.set(firefighter.team, bucket);
    }
    return byTeam;
  }, [firefighters]);

  const yearlySummary = useMemo<YearSummaryRow[]>(() => {
    const totalByTeam = new Map<TeamCode, number>([
      ['A', 0],
      ['B', 0],
      ['C', 0],
      ['D', 0],
      ['AP', 0],
    ]);

    for (const day of planningDays) {
      totalByTeam.set(day.morningTeam, (totalByTeam.get(day.morningTeam) ?? 0) + day.hoursPerShift);
      totalByTeam.set(day.nightTeam, (totalByTeam.get(day.nightTeam) ?? 0) + day.hoursPerShift);
    }

    return firefighters.map((firefighter) => {
      const totalHours = Number((totalByTeam.get(firefighter.team) ?? 0).toFixed(1));
      return {
        firefighterCode: firefighter.code,
        firefighterName: firefighter.name,
        team: firefighter.team,
        totalHours,
        status: getStatus(totalHours),
      };
    });
  }, [firefighters, planningDays]);

  const handleNameChange = (code: string, name: string) => {
    setFirefighters((previous) => previous.map((ff) => (ff.code === code ? { ...ff, name } : ff)));
  };

  const handleTeamChange = (code: string, team: TeamCode) => {
    setFirefighters((previous) => previous.map((ff) => (ff.code === code ? { ...ff, team } : ff)));
  };

  return (
    <div className="d-flex flex-column gap-3">
      <Card>
        <Card.Header className="d-flex flex-column gap-1">
          <strong>Planificación anual de turnos</strong>
          <span className="text-muted small">Configura 14 bomberos en trinomios y genera turnos hasta el 31 de diciembre.</span>
        </Card.Header>
        <Card.Body>
          <Alert variant="info" className="mb-0">
            Los equipos A, B, C y D participan en la rotación. El equipo AP ({'B13 / B14'}) queda como apoyo puntual.
          </Alert>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>1) Configuración de bomberos (14 slots)</strong>
        </Card.Header>
        <Card.Body>
          <Row className="g-3">
            {firefighters.map((firefighter) => {
              const apSlot = firefighter.code === 'B13' || firefighter.code === 'B14';
              return (
                <Col md={6} lg={4} key={firefighter.code}>
                  <Card className="h-100 border-light-subtle">
                    <Card.Body className="d-flex flex-column gap-2">
                      <div className="d-flex justify-content-between align-items-center">
                        <strong>{firefighter.code}</strong>
                        <Badge bg={firefighter.team === 'AP' ? 'secondary' : 'primary'}>{firefighter.team}</Badge>
                      </div>
                      <Form.Group>
                        <Form.Label className="small text-muted mb-1">Nombre</Form.Label>
                        <Form.Control
                          value={firefighter.name}
                          onChange={(event) => handleNameChange(firefighter.code, event.target.value)}
                          placeholder={`Nombre de ${firefighter.code}`}
                        />
                      </Form.Group>
                      <Form.Group>
                        <Form.Label className="small text-muted mb-1">Equipo</Form.Label>
                        <Form.Select
                          value={firefighter.team}
                          disabled={apSlot}
                          onChange={(event) => handleTeamChange(firefighter.code, event.target.value as TeamCode)}
                        >
                          <option value="A">Trinomio A</option>
                          <option value="B">Trinomio B</option>
                          <option value="C">Trinomio C</option>
                          <option value="D">Trinomio D</option>
                          <option value="AP">Apoyo (AP)</option>
                        </Form.Select>
                      </Form.Group>
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
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
                <th>Turno noche</th>
              </tr>
            </thead>
            <tbody>
              {selectedMonthDays.map((day) => (
                <tr key={day.date.toISOString()}>
                  <td>{formatDate(day.date)}</td>
                  <td>
                    <Badge bg={day.dayType === 'ESPECIAL' ? 'warning' : 'info'} text={day.dayType === 'ESPECIAL' ? 'dark' : undefined}>
                      {day.dayType}
                    </Badge>
                  </td>
                  <td>
                    <strong>{day.morningTeam}</strong> · {day.hoursPerShift}h ·{' '}
                    {(firefightersByTeam.get(day.morningTeam) ?? []).map((member) => member.name).join(', ')}
                  </td>
                  <td>
                    <strong>{day.nightTeam}</strong> · {day.hoursPerShift}h ·{' '}
                    {(firefightersByTeam.get(day.nightTeam) ?? []).map((member) => member.name).join(', ')}
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
            if (!firstDate) return null;
            return (
              <Card
                key={month}
                className={`p-2 ${selectedMonthIndex === month ? 'border-primary' : 'border-light-subtle'}`}
                style={{ minWidth: 180 }}
              >
                <div className="fw-semibold text-capitalize">{formatMonthYear(firstDate)}</div>
                <div className="small text-muted">Ordinarios: {ordinary}</div>
                <div className="small text-muted">Especiales: {special}</div>
                <div className="small text-muted">Días planificados: {days.length}</div>
              </Card>
            );
          })}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>4) Resumen por bombero (objetivo {TARGET_ANNUAL_HOURS.toLocaleString('es-ES')} h)</strong>
        </Card.Header>
        <Card.Body className="table-responsive">
          <Table size="sm" hover>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Equipo</th>
                <th>Horas estimadas</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {yearlySummary.map((row) => (
                <tr key={row.firefighterCode}>
                  <td>{row.firefighterCode}</td>
                  <td>{row.firefighterName}</td>
                  <td>{row.team}</td>
                  <td>{row.totalHours.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                  <td>
                    <Badge bg={row.status === 'SOBRECARGA' ? 'danger' : row.status === 'ALTO' ? 'warning' : 'success'} text={row.status === 'ALTO' ? 'dark' : undefined}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
