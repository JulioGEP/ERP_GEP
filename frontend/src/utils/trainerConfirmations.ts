import type { TrainerConfirmationStatusDTO } from '../api/sessions.types';

export const TRAINER_CONFIRMATION_STATUS_VALUES = [
  'PENDING',
  'MAIL_SENT',
  'CONFIRMED',
  'DECLINED',
] as const satisfies ReadonlyArray<TrainerConfirmationStatusDTO['status']>;

export function normalizeTrainerConfirmationStatus(value: unknown): TrainerConfirmationStatusDTO['status'] {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if ((TRAINER_CONFIRMATION_STATUS_VALUES as readonly string[]).includes(normalized)) {
      return normalized as TrainerConfirmationStatusDTO['status'];
    }
  }
  return 'PENDING';
}

function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

export function normalizeTrainerConfirmation(raw: any): TrainerConfirmationStatusDTO {
  return {
    trainer_id: toStringValue(raw?.trainer_id) ?? '',
    status: normalizeTrainerConfirmationStatus(raw?.status),
    mail_sent_at: toStringValue(raw?.mail_sent_at),
    updated_at: toStringValue(raw?.updated_at),
  };
}

export const TRAINER_CONFIRMATION_STATUS_LABELS: Record<
  TrainerConfirmationStatusDTO['status'],
  string
> = {
  PENDING: 'Mail sin enviar',
  MAIL_SENT: 'Mail enviado',
  CONFIRMED: 'Confirmado',
  DECLINED: 'Rechazado',
};

export const TRAINER_CONFIRMATION_STATUS_BADGE_VARIANTS: Record<
  TrainerConfirmationStatusDTO['status'],
  'warning' | 'primary' | 'success' | 'danger'
> = {
  PENDING: 'warning',
  MAIL_SENT: 'primary',
  CONFIRMED: 'success',
  DECLINED: 'danger',
};

export function getTrainerConfirmationLabel(status: TrainerConfirmationStatusDTO['status']): string {
  return TRAINER_CONFIRMATION_STATUS_LABELS[status] ?? TRAINER_CONFIRMATION_STATUS_LABELS.PENDING;
}
