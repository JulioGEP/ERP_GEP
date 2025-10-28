import { requestJson } from './client';

export type UserSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
};

export type UpdateUserPayload = Partial<CreateUserPayload>;

export async function fetchUsers(params: {
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<UsersListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params.search) searchParams.set('search', params.search);

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
