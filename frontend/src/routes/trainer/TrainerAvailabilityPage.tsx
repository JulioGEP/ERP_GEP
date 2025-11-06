import { Card } from 'react-bootstrap';

export function TrainerAvailabilityPage() {
  return (
    <section className="d-grid gap-3">
      <header className="d-grid gap-2">
        <h1 className="h3 fw-bold mb-0">Disponibilidad</h1>
        <p className="text-muted mb-0">
          Muy pronto podrás gestionar aquí tu disponibilidad para nuevas sesiones.
        </p>
      </header>
      <Card className="shadow-sm border-0">
        <Card.Body className="text-muted">
          Esta sección estará disponible próximamente.
        </Card.Body>
      </Card>
    </section>
  );
}

