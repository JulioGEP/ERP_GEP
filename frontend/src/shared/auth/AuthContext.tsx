import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../../api/client';
import { fetchSession, login as loginRequest, logout as logoutRequest, type AuthUser } from '../../api/auth';
import { computeDefaultPath, getPermissionsForRole, hasPermission, type PermissionList } from './utils';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  permissions: PermissionList;
  login: (email: string, password: string, role?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  hasPermission: (path: string) => boolean;
  getDefaultPath: () => string;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionList>([]);

  const applySession = useCallback((nextUser: AuthUser | null, nextPermissions: PermissionList) => {
    setUser(nextUser);
    setPermissions(nextPermissions);
    setStatus(nextUser ? 'authenticated' : 'unauthenticated');
  }, []);

  const loadSession = useCallback(async () => {
    setStatus('loading');
    try {
      const session = await fetchSession();
      applySession(session.user, session.permissions ?? []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        applySession(null, []);
        return;
      }
      console.error('[auth] No se pudo recuperar la sesión', error);
      applySession(null, []);
    }
  }, [applySession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(
    async (email: string, password: string, role?: string) => {
      const response = await loginRequest(email, password, role);
      applySession(response.user, response.permissions ?? []);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch (error) {
      console.warn('[auth] Error cerrando sesión', error);
    } finally {
      applySession(null, []);
    }
  }, [applySession]);

  const refreshSession = useCallback(async () => {
    try {
      const session = await fetchSession();
      applySession(session.user, session.permissions ?? []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        applySession(null, []);
        return;
      }
      console.error('[auth] No se pudo refrescar la sesión', error);
    }
  }, [applySession]);

  const hasPermissionMemo = useCallback(
    (path: string) => {
      if (status !== 'authenticated') return false;
      return hasPermission(path, permissions);
    },
    [permissions, status],
  );

  const getDefaultPath = useCallback(() => computeDefaultPath(permissions), [permissions]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      permissions,
      login,
      logout,
      refreshSession,
      hasPermission: hasPermissionMemo,
      getDefaultPath,
    }),
    [status, user, permissions, login, logout, refreshSession, hasPermissionMemo, getDefaultPath],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
}

export function useRolePermissions(role: string | null | undefined): PermissionList {
  return useMemo(() => getPermissionsForRole(role), [role]);
}
