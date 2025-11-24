// backend/functions/_shared/trainerUsers.ts
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { erp_role } from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';

const DEFAULT_PASSWORD = '123456';
const BCRYPT_SALT_ROUNDS = 10;

type PrismaClientLike = Prisma.TransactionClient | PrismaClient;

export type TrainerRecordForUserSync = {
  trainer_id: string;
  name: string;
  apellido: string | null;
  email: string | null;
  activo: boolean;
  user_id: string | null;
};

export async function syncUserForTrainer(
  prisma: PrismaClientLike,
  trainer: TrainerRecordForUserSync,
): Promise<string | null> {
  if (!trainer.email) return null;

  const userPayload: Prisma.usersUpdateInput = {
    first_name: trainer.name,
    last_name: trainer.apellido ?? '',
    email: trainer.email,
    role: erp_role.Formador,
    active: Boolean(trainer.activo),
    updated_at: new Date(),
  };

  let userId: string | null = trainer.user_id ?? null;

  if (userId) {
    try {
      const updatedUser = await prisma.users.update({
        where: { id: userId },
        data: userPayload,
        select: { id: true },
      });
      userId = updatedUser.id;
    } catch (error: unknown) {
      userId = null;
    }
  }

  if (!userId) {
    const existing = await prisma.users.findFirst({
      where: { email: { equals: trainer.email, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      const updated = await prisma.users.update({
        where: { id: existing.id },
        data: userPayload,
        select: { id: true },
      });
      userId = updated.id;
    } else {
      const now = new Date();
      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_SALT_ROUNDS);
      const created = await prisma.users.create({
        data: {
          id: randomUUID(),
          first_name: trainer.name,
          last_name: trainer.apellido ?? '',
          email: trainer.email,
          role: erp_role.Formador,
          active: Boolean(trainer.activo),
          password_hash: passwordHash,
          password_algo: 'bcrypt',
          password_updated_at: now,
          created_at: now,
          updated_at: now,
        },
        select: { id: true },
      });
      userId = created.id;
    }
  }

  if (!trainer.user_id || trainer.user_id !== userId) {
    await prisma.trainers.update({
      where: { trainer_id: trainer.trainer_id },
      data: { user_id: userId },
    });
  }

  return userId;
}
