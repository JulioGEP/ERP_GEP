import { Container } from 'react-bootstrap';

export default function ForbiddenPage() {
  return (
    <Container className="py-5">
      <div className="text-center d-grid gap-3">
        <h1 className="display-5 fw-bold">403</h1>
        <p className="lead">No tienes permisos para acceder a esta sección.</p>
        <p className="text-muted">Contacta con un administrador si crees que se trata de un error.</p>
      </div>
    </Container>
  );
}
