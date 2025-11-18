import type {
  SessionDTO,
  SessionTrainerInviteStatus,
  SessionTrainerInviteSummary,
} from '../api';

export type TrainerInviteStatusMap = Record<string, SessionTrainerInviteStatus>;

function normalizeTrainerId(id: string | null | undefined): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length ? trimmed : null;
}

function toSessionStatus(status: SessionTrainerInviteSummary['status']): SessionTrainerInviteStatus {
  if (status === 'CONFIRMED') return 'CONFIRMED';
  if (status === 'DECLINED') return 'DECLINED';
  return 'PENDING';
}

export function buildTrainerInviteStatusMap(
  trainerIds: readonly string[],
  invites: readonly SessionTrainerInviteSummary[] | null | undefined,
): TrainerInviteStatusMap {
  const base = syncTrainerInviteStatusMap(undefined, trainerIds);
  if (!invites || !invites.length) {
    return base;
  }

  const next: TrainerInviteStatusMap = { ...base };
  for (const invite of invites) {
    const trainerId = normalizeTrainerId(invite?.trainer_id ?? null);
    if (!trainerId || !(trainerId in next)) continue;
    next[trainerId] = toSessionStatus(invite.status);
  }
  return next;
}

export function syncTrainerInviteStatusMap(
  current: TrainerInviteStatusMap | undefined,
  trainerIds: readonly string[],
  defaultStatus: SessionTrainerInviteStatus = 'NOT_SENT',
): TrainerInviteStatusMap {
  const next: TrainerInviteStatusMap = {};
  for (const id of trainerIds) {
    const trainerId = normalizeTrainerId(id);
    if (!trainerId) continue;
    next[trainerId] = current?.[trainerId] ?? defaultStatus;
  }
  return next;
}

export function summarizeTrainerInviteStatus(map: TrainerInviteStatusMap): SessionTrainerInviteStatus {
  const values = Object.values(map);
  if (!values.length) {
    return 'NOT_SENT';
  }
  if (values.includes('DECLINED')) return 'DECLINED';
  if (values.includes('CONFIRMED')) return 'CONFIRMED';
  if (values.includes('PENDING')) return 'PENDING';
  return 'NOT_SENT';
}

export function setTrainerInviteStatusForIds(
  map: TrainerInviteStatusMap,
  trainerIds: readonly string[],
  status: SessionTrainerInviteStatus,
): TrainerInviteStatusMap {
  if (!trainerIds.length) return map;
  const next: TrainerInviteStatusMap = { ...map };
  for (const id of trainerIds) {
    const trainerId = normalizeTrainerId(id);
    if (!trainerId) continue;
    if (!(trainerId in next)) {
      next[trainerId] = status;
    } else {
      next[trainerId] = status;
    }
  }
  return next;
}

export function buildTrainerInviteStatusMapFromSession(session: SessionDTO): TrainerInviteStatusMap {
  return buildTrainerInviteStatusMap(session.trainer_ids ?? [], session.trainer_invites ?? []);
}
