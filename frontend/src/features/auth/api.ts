import { ApiError, requestJson } from '../../api/client';
import type { User } from '../../types/user';

export type SessionResponse = { user: User };

export async function fetchSession(): Promise<User | null> {
  try {
    const payload = await requestJson<{ ok: boolean; user: User } | { ok: boolean }>(
      '/api/auth/session',
      { method: 'GET' },
    );
    if (payload && 'user' in payload && payload.user) {
      return payload.user;
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}

export type LoginPayload = { email: string; password: string };

export async function login(payload: LoginPayload): Promise<User> {
  const response = await requestJson<{ ok: boolean; user: User }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { defaultErrorMessage: 'No se pudo iniciar sesión.' },
  );
  return response.user;
}

export async function logout(): Promise<void> {
  await requestJson('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function requestPasswordReset(email: string): Promise<string> {
  const response = await requestJson<{ ok: boolean; message?: string }>(
    '/api/auth/password-reset/request',
    {
      method: 'POST',
      body: JSON.stringify({ email }),
    },
    { defaultErrorMessage: 'No se pudo iniciar el proceso de recuperación.' },
  );
  return response.message ?? 'Si el correo existe, enviaremos instrucciones para restablecer la contraseña.';
}

export async function confirmPasswordReset(token: string, password: string): Promise<string> {
  const response = await requestJson<{ ok: boolean; message?: string }>(
    '/api/auth/password-reset/confirm',
    {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    },
    { defaultErrorMessage: 'No se pudo restablecer la contraseña.' },
  );
  return response.message ?? 'La contraseña se ha restablecido correctamente.';
}
