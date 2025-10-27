import { requestJson } from './client';
import type { CurrentUserPayload } from '../types/user';

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResponse = {
  data: {
    token: string;
    expires_at: string;
    user: CurrentUserPayload['user'];
    permissions: CurrentUserPayload['permissions'];
  };
};

export async function login(input: LoginInput): Promise<LoginResponse> {
  return requestJson('/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await requestJson('/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
