import { requestJson } from './client';

export type UserSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
  bankAccount: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  trainerId: string | null;
  trainerFixedContract: boolean | null;
  payroll: UserPayroll;
};

export type UserPayroll = {
  convenio: string;
  categoria: string;
  antiguedad: string | null;
  horasSemana: number;
  baseRetencion: number | null;
  baseRetencionDetalle: string | null;
  salarioBruto: number | null;
  salarioBrutoTotal: number | null;
  retencion: number | null;
  aportacionSsIrpf: number | null;
  aportacionSsIrpfDetalle: string | null;
  salarioLimpio: number | null;
  contingenciasComunes: number | null;
  contingenciasComunesDetalle: string | null;
  totalEmpresa: number | null;
};

export type UsersListResponse = {
  users: UserSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type CreateUserPayload = {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
  bankAccount?: string | null;
  address?: string | null;
  payroll?: Partial<UserPayroll>;
};

export type UpdateUserPayload = Partial<CreateUserPayload>;

export async function fetchUserById(id: string): Promise<UserSummary> {
  const response = await requestJson<{ user: UserSummary }>(`/users/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  return response.user;
}

export async function fetchUsers(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'active' | 'inactive';
  includeTrainers?: boolean;
  trainerFixedOnly?: boolean;
} = {}): Promise<UsersListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params.search) searchParams.set('search', params.search);
  if (params.status) searchParams.set('status', params.status);
  if (params.includeTrainers !== undefined) {
    searchParams.set('includeTrainers', params.includeTrainers ? '1' : '0');
  }
  if (params.trainerFixedOnly !== undefined) {
    searchParams.set('trainerFixedOnly', params.trainerFixedOnly ? '1' : '0');
  }

  const query = searchParams.toString();
  const url = query.length ? `/users?${query}` : '/users';
  return requestJson<UsersListResponse>(url, { method: 'GET' });
}

export async function createUser(payload: CreateUserPayload): Promise<UserSummary> {
  const response = await requestJson<{ user: UserSummary }>('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.user;
}

export async function updateUser(id: string, payload: UpdateUserPayload): Promise<UserSummary> {
  const response = await requestJson<{ user: UserSummary }>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.user;
}
