import { requestJson } from '../../api/client';
import type { User, UserRole } from '../../types/user';

export async function fetchUsers(): Promise<User[]> {
  const response = await requestJson<{ ok: boolean; users: User[] }>(
    '/api/users',
    { method: 'GET' },
    { defaultErrorMessage: 'No se pudo cargar la lista de usuarios.' },
  );
  return response.users;
}

export type CreateUserPayload = {
  firstName: string;
  lastName?: string;
  email: string;
  role: UserRole;
  password: string;
  active?: boolean;
};

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const response = await requestJson<{ ok: boolean; user: User }>(
    '/api/users',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { defaultErrorMessage: 'No se pudo crear el usuario.' },
  );
  return response.user;
}

export type UpdateUserPayload = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
  role?: UserRole;
  active?: boolean;
  password?: string | null;
};

export async function updateUser(payload: UpdateUserPayload): Promise<User> {
  const { id, ...rest } = payload;
  const response = await requestJson<{ ok: boolean; user: User }>(
    `/api/users/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(rest),
    },
    { defaultErrorMessage: 'No se pudo actualizar el usuario.' },
  );
  return response.user;
}
