import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Card, Container, Spinner } from 'react-bootstrap';
import {
  fetchVariantTrainerInvite,
  respondVariantTrainerInvite,
  type VariantTrainerInvite,
} from '../features/formacion_abierta/api';
import { buildFieldTooltip } from '../utils/fieldTooltip';

function buildTrainerDisplay(invite: VariantTrainerInvite): string {
  const parts = [invite.trainer.name, invite.trainer.last_name].filter(
    (value) => value && value.trim().length,
  );
  return parts.length ? parts.join(' ') : 'Formador';
}

function formatSede(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length ? trimmed : 'Por confirmar';
}

type FeedbackState = {
  variant: 'success' | 'danger' | 'info';
  message: string;
} | null;

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    const text = ((error as any).message as string).trim();
    if (text.length) return text;
  }
  if (typeof error === 'string' && error.trim().length) {
    return error.trim();
  }
  return fallback;
}

function formatDatePart(value: string | null, options: Intl.DateTimeFormatOptions): string | null {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat('es-ES', options).format(date);
  } catch {
    return null;
  }
}

function formatDateTimeRange(
  start: string | null,
  end: string | null,
  timeZone: string,
): { label: string; full: string } {
  const startDate = formatDatePart(start, { dateStyle: 'full', timeZone });
  const endDate = formatDatePart(end, { dateStyle: 'full', timeZone });
  const startTime = formatDatePart(start, { timeStyle: 'short', timeZone });
  const endTime = formatDatePart(end, { timeStyle: 'short', timeZone });

  if (startDate && startTime && endDate && endTime) {
    if (startDate === endDate) {
      const label = `${startDate}, ${startTime} – ${endTime}`;
      return { label, full: label };
    }
    const label = `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
    return { label, full: label };
  }

  if (startDate && startTime) {
    const label = `${startDate}, ${startTime}`;
    return { label, full: label };
  }

  if (startDate) {
    return { label: startDate, full: startDate };
  }

  if (endDate && endTime) {
    const label = `${endDate}, ${endTime}`;
    return { label, full: label };
  }

  if (endDate) {
    return { label: endDate, full: endDate };
  }

  return { label: 'Pendiente de programar', full: 'Pendiente de programar' };
}

export function PublicTrainerVariantInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<VariantTrainerInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    let isMounted = true;
    const normalizedToken = token?.trim();
    if (!normalizedToken) {
      setInvite(null);
      setError('Token no válido');
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);
    setError(null);
    setFeedback(null);

    fetchVariantTrainerInvite(normalizedToken)
      .then((data) => {
        if (!isMounted) return;
        setInvite(data);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(extractErrorMessage(err, 'No se pudo cargar la invitación'));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  const trainerName = useMemo(() => (invite ? buildTrainerDisplay(invite) : ''), [invite]);
  const dateRangeLabel = useMemo(
    () => (invite ? formatDateTimeRange(invite.variant.start_at, invite.variant.end_at, 'Europe/Madrid') : null),
    [invite],
  );

  const handleRespond = async (action: 'confirm' | 'decline') => {
    if (!invite || !token) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const updated = await respondVariantTrainerInvite(token, action);
      setInvite(updated);
      const message =
        action === 'confirm'
          ? 'Has confirmado tu participación. Gracias por aceptar la formación.'
          : 'Has rechazado esta formación. Hemos avisado al equipo.';
      setFeedback({
        variant: action === 'confirm' ? 'success' : 'info',
        message,
      });
    } catch (err) {
      setFeedback({ variant: 'danger', message: extractErrorMessage(err, 'No se pudo registrar tu respuesta') });
    } finally {
      setSubmitting(false);
    }
  };

  const currentStatus = invite?.status ?? 'PENDING';
  const productSubtitle = useMemo(() => {
    if (!invite) return null;
    const parts: string[] = [];
    if (invite.variant.product_name) {
      parts.push(invite.variant.product_name);
    }
    if (invite.variant.product_code) {
      parts.push(invite.variant.product_code);
    }
    return parts.length ? parts.join(' · ') : null;
  }, [invite]);

  return (
    <Container className="py-5" style={{ maxWidth: 720 }}>
      <Card className="shadow-sm">
        <Card.Body>
          <h1 className="h4 fw-bold mb-3">Confirmación de variante</h1>
          {loading ? (
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" role="status" />
              <span>Cargando…</span>
            </div>
          ) : error ? (
            <Alert variant="danger" className="mb-0">
              {error}
            </Alert>
          ) : invite ? (
            <div className="d-flex flex-column gap-3">
              <div>
                <div className="text-muted small">Formador</div>
                <div className="fw-semibold" title={buildFieldTooltip(trainerName)}>
                  {trainerName}
                </div>
                {invite.trainer.email ? (
                  <div className="text-muted" title={buildFieldTooltip(invite.trainer.email)}>
                    {invite.trainer.email}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-muted small">Variante</div>
                <div className="fw-semibold" title={buildFieldTooltip(invite.variant.name)}>
                  {invite.variant.name ?? 'Variante'}
                </div>
                {productSubtitle ? (
                  <div className="text-muted" title={buildFieldTooltip(productSubtitle)}>
                    {productSubtitle}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-muted small">Fecha y hora</div>
                <div title={buildFieldTooltip(dateRangeLabel?.full ?? null)}>
                  {dateRangeLabel?.label ?? 'Pendiente de programar'}
                </div>
              </div>
              <div>
                <div className="text-muted small">Sede</div>
                <div title={buildFieldTooltip(invite.variant.sede)}>{formatSede(invite.variant.sede)}</div>
              </div>
              {feedback ? <Alert variant={feedback.variant}>{feedback.message}</Alert> : null}
              {currentStatus === 'PENDING' ? (
                <div className="d-flex flex-column flex-sm-row gap-2">
                  <Button
                    variant="success"
                    disabled={submitting}
                    onClick={() => handleRespond('confirm')}
                  >
                    {submitting ? (
                      <Spinner animation="border" size="sm" role="status" className="me-2" />
                    ) : null}
                    Confirmar
                  </Button>
                  <Button
                    variant="outline-danger"
                    disabled={submitting}
                    onClick={() => handleRespond('decline')}
                  >
                    {submitting ? (
                      <Spinner animation="border" size="sm" role="status" className="me-2" />
                    ) : null}
                    Rechazar
                  </Button>
                </div>
              ) : (
                <Alert variant={currentStatus === 'CONFIRMED' ? 'success' : 'info'} className="mb-0">
                  {currentStatus === 'CONFIRMED'
                    ? 'Has confirmado esta formación. Te esperamos en la fecha indicada.'
                    : 'Registramos que has rechazado esta formación. El equipo ya ha sido avisado.'}
                </Alert>
              )}
            </div>
          ) : null}
        </Card.Body>
      </Card>
    </Container>
  );
}
