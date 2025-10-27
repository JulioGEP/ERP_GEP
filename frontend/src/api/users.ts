import { requestJson } from './client';
import type { CurrentUserPayload, PermissionsMap, User, UserRole } from '../types/user';

export type ListUsersParams = {
  page?: number;
  perPage?: number;
  role?: UserRole | 'all' | '';
  active?: 'all' | 'true' | 'false';
  q?: string;
};

export type ListUsersResponse = {
  data: User[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
};

export type CreateUserInput = {
  first_name: string;
  last_name: string;
  email: string;
  role: UserRole;
};

export type UpdateUserInput = Partial<Pick<CreateUserInput, 'first_name' | 'last_name' | 'role'>> & {
  active?: boolean;
};

export type CurrentUserResponse = {
  data: CurrentUserPayload;
};

export type UsersMutationResponse = {
  data: User;
};

function buildQueryString(params: ListUsersParams): string {
  const searchParams = new URLSearchParams();

  if (params.page && params.page > 1) {
    searchParams.set('page', String(params.page));
  }

  if (params.perPage && params.perPage > 0) {
    searchParams.set('per_page', String(params.perPage));
  }

  if (params.q) {
    searchParams.set('q', params.q.trim());
  }

  if (params.role && params.role !== 'all') {
    searchParams.set('role', params.role);
  }

  if (params.active && params.active !== 'all') {
    searchParams.set('active', params.active);
  }

  const query = searchParams.toString();
  return query.length ? `?${query}` : '';
}

export async function fetchUsers(params: ListUsersParams = {}): Promise<ListUsersResponse> {
  const query = buildQueryString(params);
  return requestJson(`/users${query}`);
}

export async function createUser(input: CreateUserInput): Promise<UsersMutationResponse> {
  return requestJson('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<UsersMutationResponse> {
  return requestJson(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function fetchCurrentUser(): Promise<CurrentUserResponse> {
  return requestJson('/me');
}

export type AuthorizationHelpers = {
  canAccessRoute: (path: string) => boolean;
  canPerformAction: (action: string) => boolean;
  defaultRoute: string;
  allowedRoutes: string[];
};

export function buildAuthorizationHelpers(
  role: UserRole,
  permissions: PermissionsMap | null | undefined,
): AuthorizationHelpers {
  const normalizedPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed.length) return '';
    return trimmed.endsWith('/') && trimmed !== '/' ? trimmed.slice(0, -1) : trimmed;
  };

  const map = permissions?.[role];
  const allowAllRoutes = map?.allowAllRoutes === true;
  const allowAllActions = map?.allowAllActions === true;
  const routes = map?.routes ?? [];
  const actions = map?.actions ?? {};

  const defaultRoute = allowAllRoutes
    ? '/presupuestos/sinplanificar'
    : routes.find((route) => normalizedPath(route).length > 0) ?? '/no-autorizado';

  return {
    allowedRoutes: routes,
    defaultRoute,
    canAccessRoute: (path: string) => {
      if (path === '/no-autorizado') return true;
      if (allowAllRoutes) return true;
      const target = normalizedPath(path);
      if (!target.length) return false;
      return routes.some((route) => normalizedPath(route) === target);
    },
    canPerformAction: (action: string) => {
      if (allowAllActions) return true;
      return actions[action] === true;
    },
  };
}
