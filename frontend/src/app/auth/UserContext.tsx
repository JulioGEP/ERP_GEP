import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryObserverResult } from '@tanstack/react-query';
import type { CurrentUser } from '../../types/user';
import { fetchCurrentUser } from '../../api/auth';

export const CURRENT_USER_QUERY_KEY = ['current-user'] as const;

type CurrentUserContextValue = {
  user: CurrentUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'error';
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refresh: () => Promise<QueryObserverResult<CurrentUser | null, unknown>>;
  setUser: (user: CurrentUser | null) => void;
};

const CurrentUserContext = createContext<CurrentUserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<CurrentUser | null>({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const status: CurrentUserContextValue['status'] = isLoading
    ? 'loading'
    : isError
    ? 'error'
    : data
    ? 'authenticated'
    : 'unauthenticated';

  const refresh = useCallback(
    () => refetch({ throwOnError: false }),
    [refetch],
  );

  const setUser = useCallback(
    (user: CurrentUser | null) => {
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, user);
    },
    [queryClient],
  );

  const value = useMemo<CurrentUserContextValue>(
    () => ({
      user: data ?? null,
      status,
      isLoading,
      isFetching,
      error,
      refresh,
      setUser,
    }),
    [data, status, isLoading, isFetching, error, refresh, setUser],
  );

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserContextValue {
  const context = useContext(CurrentUserContext);
  if (!context) {
    throw new Error('useCurrentUser debe usarse dentro de un UserProvider');
  }
  return context;
}
