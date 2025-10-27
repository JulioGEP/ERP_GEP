import { Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

export default function UnauthorizedPage() {
  const navigate = useNavigate();

  return (
    <div className="py-5 text-center d-grid gap-3 justify-items-center">
      <h1 className="display-6 fw-bold">No autorizado</h1>
      <p className="text-muted mx-auto" style={{ maxWidth: 520 }}>
        No tienes permisos para acceder a esta sección. Revisa tu rol o vuelve al inicio para
        continuar navegando por el ERP.
      </p>
      <div>
        <Button variant="primary" onClick={() => navigate('/')}>Volver al inicio</Button>
      </div>
    </div>
  );
}
