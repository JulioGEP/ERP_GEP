import { useMemo, useState } from 'react';
import {
  Badge,
  ButtonGroup,
  Card,
  Col,
  Form,
  Row,
  ToggleButton,
} from 'react-bootstrap';

const QUICK_RANGE_OPTIONS = [
  { label: 'Este mes', value: 'current-month' },
  { label: 'Mes anterior', value: 'previous-month' },
  { label: 'Últimos 30 días', value: 'last-30-days' },
  { label: 'Últimos 90 días', value: 'last-90-days' },
] as const;

const GROUPING_OPTIONS = [
  { label: 'Mensual', value: 'monthly' },
  { label: 'Semanal', value: 'weekly' },
] as const;

const CHANNEL_OPTIONS = ['Web', 'Referidos', 'Paid Media', 'Eventos', 'Partners', 'Outbound'] as const;
const BUSINESS_LINES = ['Formación', 'Servicios', 'Consultoría', 'Digital'] as const;

const FUNNEL_STEPS = [
  {
    label: 'Organizaciones creadas',
    value: 248,
    helper: 'Lead real = organización creada en el periodo',
  },
  {
    label: 'Leads cualificados',
    value: 164,
    helper: 'Organizaciones con pipeline validado',
  },
  {
    label: 'Negocios abiertos',
    value: 93,
    helper: 'Organizaciones que han generado un deal',
  },
  {
    label: 'Ventas ganadas',
    value: 41,
    helper: 'Deals ganados vinculados a la organización',
  },
] as const;

const QUALITY_METRICS = [
  { label: 'Conversión a negocio', value: '37,5%' },
  { label: 'Conversión a venta', value: '16,5%' },
  { label: 'Valor medio por venta', value: '18.450 €' },
  { label: 'Tiempo medio hasta deal', value: '12 días' },
] as const;

const MONTHLY_TRENDS = [
  { period: 'Enero', leads: 198, deals: 72, wins: 34 },
  { period: 'Febrero', leads: 222, deals: 85, wins: 39 },
  { period: 'Marzo', leads: 248, deals: 93, wins: 41 },
] as const;

const CHANNEL_QUALITY = [
  { channel: 'Referidos', leads: 52, winRate: '28%', avgDeal: '24.300 €' },
  { channel: 'Paid Media', leads: 84, winRate: '12%', avgDeal: '14.100 €' },
  { channel: 'Web', leads: 61, winRate: '18%', avgDeal: '16.400 €' },
  { channel: 'Eventos', leads: 29, winRate: '31%', avgDeal: '21.900 €' },
] as const;

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildDefaultRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: formatDate(start),
    end: formatDate(now),
  };
}

export default function LeadsDashboardPage() {
  const defaultRange = useMemo(() => buildDefaultRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [quickRange, setQuickRange] = useState(QUICK_RANGE_OPTIONS[0].value);
  const [grouping, setGrouping] = useState(GROUPING_OPTIONS[0].value);
  const [channel, setChannel] = useState('');
  const [businessLine, setBusinessLine] = useState('');

  return (
    <div className="px-2 px-lg-3 py-3">
      <div className="d-flex flex-column flex-lg-row justify-content-between align-items-start gap-2 mb-4">
        <div>
          <h1 className="h3 mb-1">Reporting de Leads</h1>
          <p className="text-muted mb-0">
            Un lead = una organización creada. Todos los indicadores se basan en la fecha de creación de la
            organización y su relación posterior con negocios.
          </p>
        </div>
        <Badge bg="primary" className="align-self-start">
          Fuente oficial comité
        </Badge>
      </div>

      <Card className="mb-4">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} lg={2}>
              <Form.Label>Rango de fechas</Form.Label>
              <Form.Control
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Col>
            <Col xs={12} lg={2}>
              <Form.Label>&nbsp;</Form.Label>
              <Form.Control type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </Col>
            <Col xs={12} lg={3}>
              <Form.Label>Selector rápido</Form.Label>
              <ButtonGroup className="w-100 flex-wrap">
                {QUICK_RANGE_OPTIONS.map((option) => (
                  <ToggleButton
                    key={option.value}
                    id={`quick-${option.value}`}
                    type="radio"
                    variant={quickRange === option.value ? 'primary' : 'outline-primary'}
                    name="quick-range"
                    value={option.value}
                    checked={quickRange === option.value}
                    onChange={() => setQuickRange(option.value)}
                    className="mb-2"
                  >
                    {option.label}
                  </ToggleButton>
                ))}
              </ButtonGroup>
            </Col>
            <Col xs={12} lg={2}>
              <Form.Label>Agrupación temporal</Form.Label>
              <Form.Select value={grouping} onChange={(event) => setGrouping(event.target.value)}>
                {GROUPING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12} lg={1}>
              <Form.Label>Canal</Form.Label>
              <Form.Select value={channel} onChange={(event) => setChannel(event.target.value)}>
                <option value="">Todos</option>
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12} lg={2}>
              <Form.Label>Línea de negocio</Form.Label>
              <Form.Select value={businessLine} onChange={(event) => setBusinessLine(event.target.value)}>
                <option value="">Todas</option>
                {BUSINESS_LINES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Row className="g-3 mb-4">
        {FUNNEL_STEPS.map((step) => (
          <Col key={step.label} xs={12} md={6} xl={3}>
            <Card className="h-100">
              <Card.Body>
                <p className="text-muted mb-2">{step.label}</p>
                <h2 className="fw-semibold mb-2">{step.value}</h2>
                <small className="text-muted">{step.helper}</small>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Row className="g-3 mb-4">
        <Col xs={12} xl={8}>
          <Card className="h-100">
            <Card.Header className="bg-white">
              <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2">
                <div>
                  <h2 className="h6 mb-1">Tendencia por periodo</h2>
                  <p className="text-muted mb-0">
                    Comparativa {grouping === 'monthly' ? 'mensual' : 'semanal'} de leads, negocios y ventas.
                  </p>
                </div>
                <Badge bg="light" text="dark">
                  {startDate} → {endDate}
                </Badge>
              </div>
            </Card.Header>
            <Card.Body>
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Leads</th>
                      <th>Negocios</th>
                      <th>Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MONTHLY_TRENDS.map((row) => (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td>{row.leads}</td>
                        <td>{row.deals}</td>
                        <td>{row.wins}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={12} xl={4}>
          <Card className="h-100">
            <Card.Header className="bg-white">
              <h2 className="h6 mb-0">Calidad del lead</h2>
            </Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              {QUALITY_METRICS.map((metric) => (
                <div key={metric.label} className="d-flex justify-content-between align-items-center">
                  <span className="text-muted">{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
              <Card className="border-0 bg-light">
                <Card.Body className="py-3">
                  <p className="mb-1 fw-semibold">Diagnóstico rápido</p>
                  <small className="text-muted">
                    Los canales con mejor ratio de cierre son Referidos y Eventos. Paid Media aporta volumen, pero
                    requiere optimización.
                  </small>
                </Card.Body>
              </Card>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3">
        <Col xs={12}>
          <Card>
            <Card.Header className="bg-white">
              <h2 className="h6 mb-0">Rendimiento por canal/origen</h2>
            </Card.Header>
            <Card.Body>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Leads</th>
                      <th>Ratio venta</th>
                      <th>Ticket medio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHANNEL_QUALITY.map((row) => (
                      <tr key={row.channel}>
                        <td>{row.channel}</td>
                        <td>{row.leads}</td>
                        <td>{row.winRate}</td>
                        <td>{row.avgDeal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
