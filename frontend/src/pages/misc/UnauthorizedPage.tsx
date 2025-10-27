import { Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

export default function UnauthorizedPage() {
  const navigate = useNavigate();

  return (
    <div className="py-5 d-grid gap-3 text-center">
      <div>
        <h1 className="h3 fw-bold mb-2">No autorizado</h1>
        <p className="text-muted mb-0">No tienes permisos para acceder a esta sección.</p>
      </div>
      <div>
        <Button variant="primary" onClick={() => navigate('/')}>Ir al inicio</Button>
      </div>
    </div>
  );
}
