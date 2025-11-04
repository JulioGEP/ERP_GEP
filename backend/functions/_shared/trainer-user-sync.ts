import { normalizeEmail } from './auth';

const TRAINER_ROLE = 'formador';
const DEFAULT_FIRST_NAME = 'Formador';
const DEFAULT_LAST_NAME = 'GEP';

type PrismaClientOrTransaction = {
  users: {
    findUnique(args: { where: any }): Promise<any | null>;
    findFirst(args: { where: any }): Promise<any | null>;
    update(args: { where: any; data: any }): Promise<any>;
    create(args: { data: any }): Promise<any>;
  };
  trainers: {
    findMany(args: { where?: any; select?: any }): Promise<any[]>;
    findUnique(args: { where: any }): Promise<any | null>;
    update(args: { where: any; data: any }): Promise<any>;
  };
};

type TrainerLike = {
  trainer_id: string;
  name?: string | null;
  apellido?: string | null;
  email?: string | null;
  activo?: boolean | null;
};

type UserLike = {
  id: string;
  trainer_id?: string | null;
};

function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

function coerceTrainerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function resolveTrainerEmail(trainer: TrainerLike): string | null {
  return normalizeEmail(trainer?.email ?? null);
}

function resolveTrainerActive(trainer: TrainerLike): boolean {
  if (trainer?.activo === undefined || trainer?.activo === null) {
    return true;
  }
  return Boolean(trainer.activo);
}

function shouldUpdateUserField<T>(current: T, next: T | undefined): next is T {
  return next !== undefined && current !== next;
}

export async function ensureTrainerUser(
  prisma: PrismaClientOrTransaction,
  trainerInput: TrainerLike,
): Promise<any | null> {
  const trainerId = coerceTrainerId(trainerInput?.trainer_id);
  if (!trainerId) {
    return null;
  }

  const email = resolveTrainerEmail(trainerInput);
  if (!email) {
    return null;
  }

  const firstName = sanitizeName(trainerInput?.name, DEFAULT_FIRST_NAME);
  const lastName = sanitizeName(trainerInput?.apellido, DEFAULT_LAST_NAME);
  const active = resolveTrainerActive(trainerInput);

  const existingByTrainer = await prisma.users.findUnique({ where: { trainer_id: trainerId } });
  if (existingByTrainer) {
    const updates: Record<string, unknown> = {};

    if (shouldUpdateUserField(existingByTrainer.first_name, firstName)) {
      updates.first_name = firstName;
    }
    if (shouldUpdateUserField(existingByTrainer.last_name, lastName)) {
      updates.last_name = lastName;
    }
    if (shouldUpdateUserField(existingByTrainer.email?.toLowerCase?.(), email)) {
      updates.email = email;
    }
    if (shouldUpdateUserField(existingByTrainer.role, TRAINER_ROLE)) {
      updates.role = TRAINER_ROLE;
    }
    if (shouldUpdateUserField(existingByTrainer.active, active)) {
      updates.active = active;
    }

    if (Object.keys(updates).length > 0) {
      return prisma.users.update({ where: { id: existingByTrainer.id }, data: updates });
    }

    return existingByTrainer;
  }

  const existingByEmail = await prisma.users.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  if (existingByEmail) {
    if (existingByEmail.trainer_id && existingByEmail.trainer_id !== trainerId) {
      console.warn(
        '[trainer-user-sync] Email already associated with another trainer',
        {
          trainerId,
          conflictingTrainerId: existingByEmail.trainer_id,
          userId: existingByEmail.id,
        },
      );
      return existingByEmail;
    }

    return prisma.users.update({
      where: { id: existingByEmail.id },
      data: {
        trainer_id: trainerId,
        first_name: firstName,
        last_name: lastName,
        role: TRAINER_ROLE,
        active,
        email,
      },
    });
  }

  return prisma.users.create({
    data: {
      trainer_id: trainerId,
      first_name: firstName,
      last_name: lastName,
      email,
      role: TRAINER_ROLE,
      active,
    },
  });
}

export async function ensureTrainerUsersForAll(prisma: PrismaClientOrTransaction): Promise<void> {
  const trainers = await prisma.trainers.findMany({
    where: { email: { not: null } },
    select: {
      trainer_id: true,
      name: true,
      apellido: true,
      email: true,
      activo: true,
    },
  });

  for (const trainer of trainers) {
    try {
      await ensureTrainerUser(prisma, trainer as TrainerLike);
    } catch (error) {
      console.error('[trainer-user-sync] Failed to ensure trainer user', {
        trainerId: trainer.trainer_id,
        error,
      });
    }
  }
}

export async function updateTrainerFromUser(
  prisma: PrismaClientOrTransaction,
  user: UserLike,
  updates: {
    first_name?: string;
    last_name?: string;
    email?: string | null;
    active?: boolean;
  },
): Promise<any | null> {
  const trainerId = coerceTrainerId(user?.trainer_id);
  if (!trainerId) {
    return null;
  }

  const data: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'first_name')) {
    data.name = sanitizeName(updates.first_name, DEFAULT_FIRST_NAME);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'last_name')) {
    data.apellido = sanitizeName(updates.last_name, DEFAULT_LAST_NAME);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
    data.email = updates.email ? normalizeEmail(updates.email) : null;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'active')) {
    data.activo = Boolean(updates.active);
  }

  if (Object.keys(data).length === 0) {
    return prisma.trainers.findUnique({ where: { trainer_id: trainerId } });
  }

  try {
    return await prisma.trainers.update({ where: { trainer_id: trainerId }, data });
  } catch (error) {
    console.error('[trainer-user-sync] Failed to update trainer from user', {
      trainerId,
      error,
    });
    throw error;
  }
}
