import { requestJson } from './client';
import type { UserRole, UserSummary } from '../types/user';

export const USERS_QUERY_KEY = ['users'] as const;

type UsersResponse = {
  users?: UserSummary[];
};

type UserResponse = {
  user?: UserSummary;
};

function sanitizePayload<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      body[key] = value;
    }
  }
  return body;
}

export async function fetchUsers(): Promise<UserSummary[]> {
  const response = await requestJson<UsersResponse>('/users', { method: 'GET' });
  return Array.isArray(response?.users) ? response.users : [];
}

export type CreateUserPayload = {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  role: UserRole;
};

export async function createUser(payload: CreateUserPayload): Promise<UserSummary> {
  const response = await requestJson<UserResponse>('/users', {
    method: 'POST',
    body: JSON.stringify(sanitizePayload(payload)),
  });
  if (!response?.user) {
    throw new Error('Respuesta inválida al crear el usuario');
  }
  return response.user;
}

export type UpdateUserPayload = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  role?: UserRole;
  active?: boolean;
};

export async function updateUser({
  id,
  data,
}: {
  id: string;
  data: UpdateUserPayload;
}): Promise<UserSummary> {
  const response = await requestJson<UserResponse>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(sanitizePayload(data)),
  });
  if (!response?.user) {
    throw new Error('Respuesta inválida al actualizar el usuario');
  }
  return response.user;
}
