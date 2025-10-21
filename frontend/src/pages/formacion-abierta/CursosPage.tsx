import { Card } from 'react-bootstrap';

export type FormacionAbiertaCursosPageProps = Record<string, never>;

export default function FormacionAbiertaCursosPage(
  _props: FormacionAbiertaCursosPageProps,
) {
  return (
    <section className="d-flex flex-column gap-4">
      <header>
        <p className="text-uppercase text-muted fw-semibold mb-1">Formación Abierta</p>
        <h1 className="h3 text-uppercase mb-0">Cursos</h1>
      </header>

      <Card className="border-0 shadow-sm">
        <Card.Body className="py-5 text-center text-muted">
          <p className="mb-0">
            Todavía no hay cursos disponibles. Próximamente añadiremos contenidos para esta sección.
          </p>
        </Card.Body>
      </Card>
    </section>
  );
}
