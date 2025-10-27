import { ApiError, requestJson } from './client';
import type { CurrentUser } from '../types/user';

export type LoginPayload = {
  email: string;
  password: string;
};

export async function login(payload: LoginPayload): Promise<CurrentUser> {
  const response = await requestJson<{ me: CurrentUser | null }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response?.me) {
    throw new ApiError('INVALID_RESPONSE', 'No se pudo iniciar sesión correctamente');
  }

  return response.me;
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const response = await requestJson<{ me: CurrentUser | null }>('/auth/me', {
      method: 'GET',
    });
    return response?.me ?? null;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.code === 'UNAUTHORIZED')) {
      return null;
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  await requestJson('/auth/logout', {
    method: 'POST',
  });
}

export async function forgotPassword(email: string): Promise<string | null> {
  const response = await requestJson<{ message?: string }>(
    '/auth/forgot-password',
    {
      method: 'POST',
      body: JSON.stringify({ email }),
    },
    {
      defaultErrorMessage: 'No se pudo procesar la solicitud. Inténtalo de nuevo más tarde.',
    },
  );
  return response?.message ?? null;
}

export type ResetPasswordPayload = {
  token: string;
  newPassword: string;
};

export async function resetPassword({ token, newPassword }: ResetPasswordPayload): Promise<string | null> {
  const response = await requestJson<{ message?: string }>(
    '/auth/reset-password',
    {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    },
    {
      defaultErrorMessage: 'No se pudo actualizar la contraseña. Inténtalo de nuevo más tarde.',
    },
  );
  return response?.message ?? null;
}
