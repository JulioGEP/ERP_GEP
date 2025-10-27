import { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  buildAuthorizationHelpers,
  fetchCurrentUser,
  type AuthorizationHelpers,
  type CurrentUserResponse,
} from '../api/users';
import type { PermissionsMap, User } from '../types/user';

type CurrentUserContextValue = {
  currentUser: User | null;
  permissions: PermissionsMap | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<CurrentUserResponse | undefined>;
  authorization: AuthorizationHelpers;
};

const FALLBACK_AUTHORIZATION: AuthorizationHelpers = {
  allowedRoutes: [],
  defaultRoute: '/no-autorizado',
  canAccessRoute: (path: string) => path === '/no-autorizado',
  canPerformAction: () => false,
};

const CurrentUserContext = createContext<CurrentUserContextValue | undefined>(undefined);

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const query = useQuery({
    queryKey: ['current-user'],
    queryFn: fetchCurrentUser,
    staleTime: Infinity,
    retry: false,
  });

  const payload = query.data?.data ?? null;
  const user = payload?.user ?? null;
  const permissions = payload?.permissions ?? null;

  const authorization = useMemo(() => {
    if (!user) {
      return FALLBACK_AUTHORIZATION;
    }
    return buildAuthorizationHelpers(user.role, permissions);
  }, [permissions, user]);

  const value: CurrentUserContextValue = {
    currentUser: user,
    permissions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ?? null,
    refetch: async () => {
      const result = await query.refetch();
      return result.data;
    },
    authorization,
  };

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser() {
  const context = useContext(CurrentUserContext);
  if (!context) {
    throw new Error('useCurrentUser debe usarse dentro de CurrentUserProvider');
  }
  return context;
}
