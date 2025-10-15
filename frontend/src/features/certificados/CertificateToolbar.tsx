import { Button } from 'react-bootstrap';

type CertificateToolbarProps = {
  onGenerate?: () => void;
  disabled?: boolean;
};

export function CertificateToolbar({ onGenerate, disabled }: CertificateToolbarProps) {
  return (
    <div className="certificate-toolbar">
      <div className="certificate-toolbar__info text-muted">
        Ajusta los datos de los alumnos antes de generar los certificados.
      </div>
      <Button
        variant="primary"
        onClick={onGenerate}
        disabled={disabled}
        className="certificate-toolbar__button"
      >
        Generar certificados
      </Button>
    </div>
  );
}
