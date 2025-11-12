import type { Prisma, PrismaClient, TrainerConfirmationState } from '@prisma/client';
import { toMadridISOString } from './timezone';

export type TrainerConfirmationRecord = {
  trainer_id: string;
  status: TrainerConfirmationState;
  mail_sent_at: Date | string | null;
  updated_at: Date | string | null;
};

type PrismaOrTransaction = PrismaClient | Prisma.TransactionClient;

type SyncParams = {
  prisma: PrismaOrTransaction;
  trainerIds: string[];
  sessionId?: string | null;
  variantId?: string | null;
};

function uniqueTrainerIds(ids: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function serializeTrainerConfirmation(record: TrainerConfirmationRecord) {
  return {
    trainer_id: record.trainer_id,
    status: record.status,
    mail_sent_at: toMadridISOString(record.mail_sent_at),
    updated_at: toMadridISOString(record.updated_at),
  };
}

export async function syncTrainerConfirmations({
  prisma,
  trainerIds,
  sessionId = null,
  variantId = null,
}: SyncParams): Promise<void> {
  const normalizedIds = uniqueTrainerIds(trainerIds);

  const existing = await prisma.trainer_confirmation_status.findMany({
    where: {
      sesion_id: sessionId,
      variant_id: variantId,
    },
    select: { trainer_id: true },
  });

  const existingIds = new Set(existing.map((item) => item.trainer_id));
  const toCreate = normalizedIds.filter((id) => !existingIds.has(id));
  const toRemove = existing
    .map((item) => item.trainer_id)
    .filter((id) => !normalizedIds.includes(id));

  if (toRemove.length) {
    await prisma.trainer_confirmation_status.deleteMany({
      where: {
        trainer_id: { in: toRemove },
        sesion_id: sessionId,
        variant_id: variantId,
      },
    });
  }

  if (toCreate.length) {
    await prisma.trainer_confirmation_status.createMany({
      data: toCreate.map((trainerId) => ({
        trainer_id: trainerId,
        sesion_id: sessionId,
        variant_id: variantId,
        status: 'PENDING' as TrainerConfirmationState,
      })),
      skipDuplicates: true,
    });
  }
}
