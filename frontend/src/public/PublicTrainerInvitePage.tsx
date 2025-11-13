import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Card, Container, Spinner } from 'react-bootstrap';
import {
  fetchSessionTrainerInvite,
  fetchVariantTrainerInvite,
  respondSessionTrainerInvite,
  respondVariantTrainerInvite,
  type TrainerInvite,
} from '../features/presupuestos/api';
import { buildFieldTooltip } from '../utils/fieldTooltip';

const MADRID_TIMEZONE = 'Europe/Madrid';

type PublicTrainerInvitePageProps = {
  inviteType: 'session' | 'variant';
};

type FeedbackState = {
  variant: 'success' | 'danger' | 'info';
  message: string;
} | null;

function buildTrainerDisplay(invite: TrainerInvite): string {
  const parts = [invite.trainer.name, invite.trainer.last_name]
    .map((value) => (value ? value.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(' ') : 'Formador';
}

function formatAddress(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length ? trimmed : 'Por confirmar';
}

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

export function PublicTrainerInvitePage({ inviteType }: PublicTrainerInvitePageProps) {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<TrainerInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    let isMounted = true;
    const normalizedToken = (token ?? '').trim();
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

    const fetchFn = inviteType === 'variant' ? fetchVariantTrainerInvite : fetchSessionTrainerInvite;

    fetchFn(normalizedToken)
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
  }, [token, inviteType]);

  const resolvedType: 'session' | 'variant' = invite?.type ?? inviteType;
  const isVariantInvite = resolvedType === 'variant';
  const variantInfo = invite?.variant ?? null;
  const sessionInfo = invite?.session ?? null;
  const trainerName = useMemo(() => (invite ? buildTrainerDisplay(invite) : ''), [invite]);

  const dateRangeLabel = useMemo(() => {
    if (!invite) return null;
    if (isVariantInvite) {
      const start = variantInfo?.start_at ?? variantInfo?.date ?? null;
      const end = variantInfo?.end_at ?? variantInfo?.date ?? null;
      return formatDateTimeRange(start, end, MADRID_TIMEZONE);
    }
    return formatDateTimeRange(sessionInfo?.start_at ?? null, sessionInfo?.end_at ?? null, MADRID_TIMEZONE);
  }, [invite, isVariantInvite, variantInfo, sessionInfo]);

  const handleRespond = async (action: 'confirm' | 'decline') => {
    const normalizedToken = (token ?? '').trim();
    if (!invite || !normalizedToken) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const responder = resolvedType === 'variant' ? respondVariantTrainerInvite : respondSessionTrainerInvite;
      const updated = await responder(normalizedToken, action);
      setInvite(updated);
      const message =
        action === 'confirm'
          ? resolvedType === 'variant'
            ? 'Has confirmado tu asistencia. Gracias por aceptar la formación.'
            : 'Has confirmado tu asistencia. Gracias por aceptar la sesión.'
          : resolvedType === 'variant'
            ? 'Has rechazado la formación. Hemos avisado al equipo.'
            : 'Has rechazado la sesión. Hemos avisado al equipo.';
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
  const heading = isVariantInvite ? 'Confirmación de formación' : 'Confirmación de sesión';
  const activityLabel = isVariantInvite
    ? variantInfo?.name ?? variantInfo?.product_name ?? 'Formación'
    : sessionInfo?.name ?? 'Sesión';
  const subtitle = isVariantInvite
    ? variantInfo?.product_name && variantInfo.product_name !== activityLabel
      ? variantInfo.product_name
      : variantInfo?.product_code ?? null
    : sessionInfo?.deal_title ?? null;
  const location = isVariantInvite ? formatAddress(variantInfo?.site ?? null) : formatAddress(sessionInfo?.address ?? null);

  return (
    <Container className="py-5" style={{ maxWidth: 720 }}>
      <Card className="shadow-sm">
        <Card.Body>
          <h1 className="h4 fw-bold mb-3">{heading}</h1>
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
                <div className="text-muted small">{isVariantInvite ? 'Formación' : 'Sesión'}</div>
                <div className="fw-semibold" title={buildFieldTooltip(activityLabel)}>
                  {activityLabel}
                </div>
                {subtitle ? (
                  <div className="text-muted" title={buildFieldTooltip(subtitle)}>
                    {subtitle}
                  </div>
                ) : null}
                {isVariantInvite && variantInfo?.product_code ? (
                  <div className="text-muted" title={buildFieldTooltip(variantInfo.product_code)}>
                    Código: {variantInfo.product_code}
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
                <div className="text-muted small">Ubicación</div>
                <div title={buildFieldTooltip(location)}>{location}</div>
              </div>
              {feedback ? (
                <Alert variant={feedback.variant}>{feedback.message}</Alert>
              ) : null}
              <div className="d-flex flex-wrap gap-2">
                <Button
                  variant="success"
                  disabled={submitting || currentStatus !== 'PENDING'}
                  onClick={() => handleRespond('confirm')}
                >
                  {submitting ? 'Enviando…' : 'Confirmar asistencia'}
                </Button>
                <Button
                  variant="outline-danger"
                  disabled={submitting || currentStatus !== 'PENDING'}
                  onClick={() => handleRespond('decline')}
                >
                  {submitting ? 'Enviando…' : 'No puedo asistir'}
                </Button>
              </div>
              {currentStatus !== 'PENDING' ? (
                <Alert variant="info" className="mb-0">
                  Ya registraste tu respuesta como <strong>{currentStatus.toLowerCase()}</strong>.
                </Alert>
              ) : null}
            </div>
          ) : (
            <Alert variant="warning" className="mb-0">
              No se encontró la invitación.
            </Alert>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}

export default PublicTrainerInvitePage;
