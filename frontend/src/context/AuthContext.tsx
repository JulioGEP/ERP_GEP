// frontend/src/context/AuthContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  PropsWithChildren,
} from 'react';
import { getJson, postJson, ApiError, SESSION_EXPIRED_EVENT } from '../api/client';

type User = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
  trainerId?: string | null;
};

type SessionPayload = {
  user: User | null;
  permissions: readonly string[];
};

type AuthState = {
  user: User | null;
  permissions: readonly string[];
  isLoading: boolean;
  // acciones
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // utilidades
  isAuthenticated: boolean;
  hasPermission: (path: string) => boolean;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

// --- Helpers internos ---

function normalizePath(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  const trimmed = path.trim();
  if (!trimmed.length) return '';
  const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return normalized || '/';
}

function hasPermissionImpl(path: string, permissions: readonly string[]): boolean {
  if (!path) return false;
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes('ALL' as any)) return true;

  const normalizedPath = normalizePath(path);
  return permissions.some((perm) => {
    const p = normalizePath(perm);
    if (p === normalizedPath) return true;
    if (p.endsWith('/*')) {
      const base = p.slice(0, -2);
      return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
    }
    return false;
  });
}

// --- Provider ---

export function AuthProvider({ children }: PropsWithChildren<{}>) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const hadValidSessionRef = useRef<boolean>(false);

  const loadSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getJson<SessionPayload>('/auth-session');
      setUser(data.user);
      setPermissions(data.permissions || []);
      hadValidSessionRef.current = Boolean(data.user);
      setSessionExpired(false);
    } catch (err) {
      // Si el backend devolviese 500, mostramos estado no autenticado
      if (err instanceof ApiError && err.status && err.status >= 500) {
        console.error('[auth-session] error', err);
      }
      const expired = hadValidSessionRef.current && err instanceof ApiError && err.status === 401;
      setUser(null);
      setPermissions([]);
      setSessionExpired(expired);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      if (!hadValidSessionRef.current) return;
      setSessionExpired(true);
      setUser(null);
      setPermissions([]);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
      return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    }

    return undefined;
  }, []);

  useEffect(() => {
    // Cargar sesión al montar
    loadSession();
  }, [loadSession]);

  const login = useCallback(async (email: string, password: string) => {
    // POST login; el backend setea cookie HttpOnly
    await postJson<{ user: User; permissions: readonly string[] }>('/auth-login', {
      email,
      password,
    });
    // Tras login, refrescamos sesión
    await loadSession();
  }, [loadSession]);

  const logout = useCallback(async () => {
    try {
      await postJson('/auth-logout', {});
    } finally {
      // Limpiar estado siempre
      setUser(null);
      setPermissions([]);
      setSessionExpired(false);
      hadValidSessionRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadSession();
  }, [loadSession]);

  const isAuthenticated = !!user;

  const hasPermission = useCallback(
    (path: string) => hasPermissionImpl(path, permissions),
    [permissions]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      permissions,
      isLoading,
      refresh,
      login,
      logout,
      isAuthenticated,
      hasPermission,
    }),
    [user, permissions, isLoading, refresh, login, logout, isAuthenticated, hasPermission]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {sessionExpired && <SessionExpiredOverlay />}
    </AuthContext.Provider>
  );
}

// --- Hook de consumo ---

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}

// --- Componentes de guardia ---

type RequireAuthProps = PropsWithChildren<{
  /** Si se pasa, fuerza que el usuario tenga uno de estos roles. Si no, solo requiere estar autenticado. */
  roles?: readonly string[];
  /** Ruta a comprobar permiso granular (opcional). Si se pasa, además verifica permisos sobre ese path. */
  allowPath?: string;
  /** UI a mostrar mientras carga. Por defecto null. */
  fallback?: React.ReactNode;
  /** UI a mostrar si no autorizado. Por defecto un bloque 403. */
  forbidden?: React.ReactNode;
}>;

/**
 * Envuelve vistas que requieren autenticación (y opcionalmente roles/permisos).
 * - Si `roles` está definido, exige que user.role ∈ roles.
 * - Si `allowPath` está definido, exige permiso explícito sobre esa ruta.
 */
export function RequireAuth({
  roles,
  allowPath,
  fallback = null,
  forbidden,
  children,
}: RequireAuthProps) {
  const { isLoading, isAuthenticated, user, hasPermission } = useAuth();

  if (isLoading) return <>{fallback}</>;

  if (!isAuthenticated) {
    // No autenticado
    return <>{forbidden ?? <Forbidden401 />}</>;
  }

  if (roles && roles.length > 0) {
    const role = user?.role?.trim();
    if (!role || !roles.includes(role)) {
      return <>{forbidden ?? <Forbidden403 />}</>;
    }
  }

  if (allowPath && !hasPermission(allowPath)) {
    return <>{forbidden ?? <Forbidden403 />}</>;
  }

  return <>{children}</>;
}

// --- UIs sencillas por defecto ---

function Forbidden401() {
  return (
    <div className="container py-5">
      <h2 className="mb-2">401 – Necesitas iniciar sesión</h2>
      <p>Tu sesión no es válida o ha expirado. Vuelve a iniciar sesión.</p>
    </div>
  );
}

function Forbidden403() {
  return (
    <div className="container py-5">
      <h2 className="mb-2">403 – No autorizado</h2>
      <p>No tienes permisos para acceder a esta sección.</p>
    </div>
  );
}

function SessionExpiredOverlay() {
  return (
    <div className="session-expired-backdrop" role="alert" aria-live="assertive">
      <div className="session-expired-panel">
        <div className="session-expired-icon" aria-hidden>
          ⚠️
        </div>
        <h1 className="session-expired-title">
          Por tu seguridad, la sesión ha caducado, tienes que recargar la página y volver a loguearte
        </h1>
        <p className="session-expired-subtitle">Recarga ahora para seguir trabajando con tu cuenta.</p>
        <button type="button" className="btn btn-light btn-lg fw-semibold" onClick={() => window.location.reload()}>
          Recargar la página
        </button>
      </div>
    </div>
  );
}
