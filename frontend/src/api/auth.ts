import { requestJson } from './client';

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
};

export type AuthResponse = {
  user: AuthUser;
  permissions: string[];
};

export async function login(email: string, password: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth-login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchSession(): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth-session', { method: 'GET' });
}

export async function logout(): Promise<void> {
  await requestJson('/auth-logout', { method: 'POST' });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await requestJson('/auth-password-reset-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}
