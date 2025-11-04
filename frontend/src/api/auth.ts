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

export type AuthSessionResponse = {
  user: AuthUser | null;
  permissions: string[];
};

export async function login(email: string, password: string, role?: string): Promise<AuthResponse> {
  return requestJson<AuthResponse>('/auth-login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(role ? { role } : {}) }),
  });
}

export async function fetchSession(): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>('/auth-session', { method: 'GET' });
}

export async function logout(): Promise<void> {
  await requestJson('/auth-logout', { method: 'POST' });
}

export type PasswordResetRequestResponse = {
  message: string;
  resetUrl?: string;
  expiresAt?: string;
};

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResponse> {
  return requestJson<PasswordResetRequestResponse>('/auth-password-reset-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export type PasswordResetConfirmResponse = {
  message: string;
};

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<PasswordResetConfirmResponse> {
  return requestJson<PasswordResetConfirmResponse>('/auth-password-reset-confirm', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export type ChangePasswordResponse = {
  message: string;
};

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResponse> {
  return requestJson<ChangePasswordResponse>('/auth-password-change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
