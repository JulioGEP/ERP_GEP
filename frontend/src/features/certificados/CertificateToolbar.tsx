import { Button, Spinner } from 'react-bootstrap';

type CertificateToolbarProps = {
  onGenerate?: () => void;
  disabled?: boolean;
  loading?: boolean;
  progress?: number;
  total?: number;
};

export function CertificateToolbar({ onGenerate, disabled, loading, progress, total }: CertificateToolbarProps) {
  const isLoading = Boolean(loading);
  const buttonDisabled = Boolean(disabled || isLoading);
  const resolvedTotal = typeof total === 'number' && total > 0 ? Math.floor(total) : null;
  const resolvedProgress =
    resolvedTotal !== null && typeof progress === 'number'
      ? Math.min(Math.max(Math.floor(progress), 0), resolvedTotal)
      : null;
  const loadingLabel = resolvedTotal !== null && resolvedProgress !== null
    ? `Generando (${resolvedProgress}/${resolvedTotal})`
    : 'Generando...';

  const handleClick = () => {
    if (isLoading || !onGenerate) {
      return;
    }
    onGenerate();
  };

  return (
    <div className="certificate-toolbar">
      <div className="certificate-toolbar__info text-muted">
        Ajusta los datos de los alumnos antes de generar los certificados.
      </div>
      <Button
        variant="primary"
        onClick={handleClick}
        disabled={buttonDisabled}
        className="certificate-toolbar__button"
      >
        {isLoading ? (
          <>
            <Spinner animation="border" size="sm" className="me-2" />
            {loadingLabel}
          </>
        ) : (
          'Generar certificados'
        )}
      </Button>
    </div>
  );
}
