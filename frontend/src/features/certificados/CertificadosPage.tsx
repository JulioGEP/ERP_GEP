import { Card } from 'react-bootstrap';

export function CertificadosPage() {
  return (
    <div className="d-flex justify-content-center">
      <Card className="shadow-sm border-0" style={{ maxWidth: '640px', width: '100%' }}>
        <Card.Body className="p-5 text-center">
          <Card.Title as="h1" className="h4 fw-bold mb-3 text-uppercase">
            Certificados
          </Card.Title>
          <Card.Text className="text-muted mb-0">
            Gestiona la emisión y el seguimiento de los certificados de formación desde este apartado.
            Muy pronto podrás cargar plantillas, generar certificados y hacer seguimiento de su estado.
          </Card.Text>
        </Card.Body>
      </Card>
    </div>
  );
}
