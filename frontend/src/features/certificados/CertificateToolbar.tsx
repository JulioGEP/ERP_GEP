import { Button, Spinner } from 'react-bootstrap';

export type CertificateToolbarProgressStatus = 'pending' | 'working' | 'success' | 'error';

type CertificateToolbarProgressDetail = {
  id: string;
  label: string;
  status: CertificateToolbarProgressStatus;
};

type CertificateToolbarProps = {
  onGenerate?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  loading?: boolean;
  progress?: number;
  total?: number;
  infoMessage?: string;
  infoDetails?: CertificateToolbarProgressDetail[];
  disabledReason?: string;
  canCancel?: boolean;
  cancelling?: boolean;
};

export function CertificateToolbar({
  onGenerate,
  onCancel,
  disabled,
  loading,
  progress,
  total,
  infoMessage,
  infoDetails,
  disabledReason,
  canCancel,
  cancelling,
}: CertificateToolbarProps) {
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
  const hasInfoDetails = Boolean(infoDetails?.length);
  const resolvedInfoMessage = !hasInfoDetails && infoMessage?.trim().length
    ? infoMessage.trim()
    : null;
  const buttonTitle = buttonDisabled && disabledReason?.trim().length ? disabledReason.trim() : undefined;
  const cancelDisabled = Boolean(cancelling || canCancel === false);

  const handleClick = () => {
    if (isLoading || !onGenerate) {
      return;
    }
    onGenerate();
  };

  const handleCancel = () => {
    if (!isLoading || !onCancel || cancelDisabled) {
      return;
    }
    onCancel();
  };

  const showCancelButton = Boolean(isLoading && onCancel);

  return (
    <div className="certificate-toolbar">
      {hasInfoDetails ? (
        <ul className="certificate-toolbar__info-list text-muted" aria-live="polite">
          {infoDetails?.map((detail) => {
            const statusClassName = `certificate-toolbar__info-status certificate-toolbar__info-status--${detail.status}`;
            const statusIcon = (() => {
              switch (detail.status) {
                case 'success':
                  return '✔️';
                case 'error':
                  return '❌';
                case 'working':
                  return '⏳';
                default:
                  return '•';
              }
            })();
            const statusLabel = (() => {
              switch (detail.status) {
                case 'success':
                  return 'Completado';
                case 'error':
                  return 'Error';
                case 'working':
                  return 'En progreso';
                default:
                  return 'Pendiente';
              }
            })();
            return (
              <li key={detail.id} className="certificate-toolbar__info-item">
                <span className={statusClassName} aria-label={statusLabel}>
                  {statusIcon}
                </span>
                <span>{detail.label}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="certificate-toolbar__info text-muted">
          {resolvedInfoMessage ?? 'Ajusta los datos de los alumnos antes de generar los certificados.'}
        </div>
      )}
      <div className="certificate-toolbar__actions">
        {showCancelButton && (
          <Button
            variant="outline-danger"
            onClick={handleCancel}
            disabled={cancelDisabled}
            className="certificate-toolbar__cancel-button"
          >
            {cancelling ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Parando...
              </>
            ) : (
              'Parar'
            )}
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleClick}
          disabled={buttonDisabled}
          title={buttonTitle}
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
    </div>
  );
}
