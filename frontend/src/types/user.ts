export type UserRole =
  | 'admin'
  | 'comercial'
  | 'administracion'
  | 'logistica'
  | 'people'
  | 'formador';

export type User = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};
