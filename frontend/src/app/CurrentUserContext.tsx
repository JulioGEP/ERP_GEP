import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildAuthorizationHelpers,
  fetchCurrentUser,
  type AuthorizationHelpers,
  type CurrentUserResponse,
} from '../api/users';
import { isApiError } from '../api/client';
import {
  getStoredAuthToken,
  setStoredAuthToken,
  subscribeAuthToken,
} from '../auth/tokenStorage';
import type { PermissionsMap, User } from '../types/user';

type AuthStatus = 'unauthenticated' | 'loading' | 'authenticated' | 'error';

type CurrentUserContextValue = {
  currentUser: User | null;
  permissions: PermissionsMap | null;
  authorization: AuthorizationHelpers;
  authToken: string | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  setAuthToken: (token: string | null) => void;
  refetch: () => Promise<CurrentUserResponse | undefined>;
};

const FALLBACK_AUTHORIZATION: AuthorizationHelpers = {
  allowedRoutes: [],
  defaultRoute: '/no-autorizado',
  canAccessRoute: (path: string) => path === '/no-autorizado',
  canPerformAction: () => false,
};

const CurrentUserContext = createContext<CurrentUserContextValue | undefined>(undefined);

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [authToken, setAuthTokenState] = useState<string | null>(() => getStoredAuthToken());

  useEffect(() => {
    const unsubscribe = subscribeAuthToken((token) => {
      const normalized = token && token.trim().length ? token : null;
      setAuthTokenState(normalized);
      if (!normalized) {
        queryClient.removeQueries({ queryKey: ['current-user'], exact: false });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  const setAuthToken = useCallback(
    (token: string | null) => {
      const normalized = token && token.trim().length ? token : null;
      setStoredAuthToken(normalized);
      setAuthTokenState(normalized);
      if (!normalized) {
        queryClient.removeQueries({ queryKey: ['current-user'], exact: false });
      }
    },
    [queryClient],
  );

  const query = useQuery({
    queryKey: ['current-user', authToken],
    queryFn: fetchCurrentUser,
    staleTime: Infinity,
    retry: false,
    enabled: Boolean(authToken),
  });

  const isUnauthorizedError =
    query.isError && isApiError(query.error) && (query.error.status === 401 || query.error.status === 403);

  useEffect(() => {
    if (isUnauthorizedError) {
      setAuthToken(null);
    }
  }, [isUnauthorizedError, setAuthToken]);

  let status: AuthStatus = 'unauthenticated';
  let user: User | null = null;
  let permissions: PermissionsMap | null = null;
  let error: unknown = null;

  if (!authToken) {
    status = 'unauthenticated';
  } else if (query.isPending || query.isLoading) {
    status = 'loading';
  } else if (query.isSuccess) {
    status = 'authenticated';
    user = query.data?.data?.user ?? null;
    permissions = query.data?.data?.permissions ?? null;
  } else if (isUnauthorizedError) {
    status = 'unauthenticated';
  } else if (query.isError) {
    status = 'error';
    error = query.error ?? null;
  }

  const authorization = useMemo(() => {
    if (!user) {
      return FALLBACK_AUTHORIZATION;
    }
    return buildAuthorizationHelpers(user.role, permissions);
  }, [permissions, user]);

  const value: CurrentUserContextValue = {
    currentUser: user,
    permissions,
    authorization,
    authToken,
    status,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    isError: status === 'error',
    error,
    setAuthToken,
    refetch: async () => {
      if (!authToken) {
        return undefined;
      }
      const result = await query.refetch();
      return result.data;
    },
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
