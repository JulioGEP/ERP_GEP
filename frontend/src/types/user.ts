export const USER_ROLES = [
  'admin',
  'comercial',
  'administracion',
  'logistica',
  'people',
  'formador',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  active: boolean;
}

export interface UserSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: UserRole;
  active: boolean;
  name?: string | null;
}
