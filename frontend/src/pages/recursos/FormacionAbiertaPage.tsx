import { Button, Card, Table } from 'react-bootstrap';
import CursosWoo from '../../features/formacion_abierta/CursosWoo';

export type RecursosFormacionAbiertaPageProps = Record<string, never>;

export default function RecursosFormacionAbiertaPage(
  _props: RecursosFormacionAbiertaPageProps,
) {
  return (
    <section className="d-flex flex-column gap-4">
      <header>
        <p className="text-uppercase text-muted fw-semibold mb-1">Recursos</p>
        <h1 className="h3 text-uppercase mb-0">Formación Abierta</h1>
      </header>

      <CursosWoo />

      <Card className="border-0 shadow-sm">
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <h2 className="h5 mb-1">¿Necesitas ayuda inmediata?</h2>
            <p className="text-muted mb-0">
              Llámanos al{' '}
              <Button as="a" href="tel:+34900123456" variant="outline-primary" size="sm">
                +34 900 123 456
              </Button>{' '}
              y nuestro equipo resolverá cualquier duda sobre los productos importados.
            </p>
          </div>

          <div>
            <h3 className="h6 mb-2">Resumen rápido de productos</h3>
            <Table responsive bordered size="sm" className="mb-0">
              <thead>
                <tr>
                  <th>Nombre del producto</th>
                  <th>ID del producto</th>
                  <th>ID de Pipedrive</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Curso de ejemplo A</td>
                  <td>1001</td>
                  <td>PD-4587</td>
                </tr>
                <tr>
                  <td>Curso de ejemplo B</td>
                  <td>1002</td>
                  <td>PD-4588</td>
                </tr>
                <tr>
                  <td>Curso de ejemplo C</td>
                  <td>1003</td>
                  <td>PD-4589</td>
                </tr>
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

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
