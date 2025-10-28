import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '../../types/user';
import { confirmPasswordReset, fetchSession, login, logout, requestPasswordReset } from './api';
import type { LoginPayload } from './api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  login: (payload: LoginPayload) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isLoggingIn: boolean;
  isLoggingOut: boolean;
  requestPasswordReset: (email: string) => Promise<string>;
  confirmPasswordReset: (token: string, password: string) => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: fetchSession,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: login,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
  });

  const requestResetMutation = useMutation({
    mutationFn: requestPasswordReset,
  });

  const confirmResetMutation = useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      confirmPasswordReset(token, password),
  });

  const user = sessionQuery.data ?? null;
  const status: AuthStatus = sessionQuery.isLoading
    ? 'loading'
    : user
    ? 'authenticated'
    : 'unauthenticated';

  const handleLogin = useCallback(
    async (payload: LoginPayload) => {
      const authenticatedUser = await loginMutation.mutateAsync(payload);
      queryClient.setQueryData(['auth', 'session'], authenticatedUser);
      return authenticatedUser;
    },
    [loginMutation, queryClient],
  );

  const handleLogout = useCallback(async () => {
    await logoutMutation.mutateAsync();
    queryClient.setQueryData(['auth', 'session'], null);
    queryClient.removeQueries({
      predicate: (query) => {
        if (!Array.isArray(query.queryKey)) return true;
        return query.queryKey[0] !== 'auth';
      },
    });
  }, [logoutMutation, queryClient]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
  }, [queryClient]);

  const requestReset = useCallback(
    async (email: string) => requestResetMutation.mutateAsync(email),
    [requestResetMutation],
  );

  const confirmReset = useCallback(
    async (token: string, password: string) =>
      confirmResetMutation.mutateAsync({ token, password }),
    [confirmResetMutation],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login: handleLogin,
      logout: handleLogout,
      refresh,
      isLoggingIn: loginMutation.isPending,
      isLoggingOut: logoutMutation.isPending,
      requestPasswordReset: requestReset,
      confirmPasswordReset: confirmReset,
    }),
    [
      confirmReset,
      handleLogin,
      handleLogout,
      loginMutation.isPending,
      logoutMutation.isPending,
      refresh,
      requestReset,
      status,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe utilizarse dentro de un AuthProvider');
  }
  return context;
}
