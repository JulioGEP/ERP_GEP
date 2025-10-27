export const USER_ROLES = [
  'comercial',
  'administracion',
  'logistica',
  'admin',
  'people',
  'formador',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type User = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type RolePermissions = {
  routes: string[];
  allowAllRoutes?: boolean;
  actions: Record<string, boolean>;
  allowAllActions?: boolean;
};

export type PermissionsMap = Record<UserRole, RolePermissions>;

export type CurrentUserPayload = {
  user: User;
  permissions: PermissionsMap;
};
