// src/App.tsx
import { lazy, Suspense, useMemo, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { useAuth } from './context/AuthContext';
import { computeDefaultPath } from './shared/auth/utils';

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp'));
let loginPagePreloadPromise: Promise<typeof import('./pages/auth/LoginPage')> | null = null;

function preloadLoginPage() {
  if (!loginPagePreloadPromise) {
    loginPagePreloadPromise = import('./pages/auth/LoginPage').catch((error) => {
      loginPagePreloadPromise = null;
      throw error;
    });
  }

  return loginPagePreloadPromise;
}

const LoginPage = lazy(() => preloadLoginPage());
const PasswordResetPage = lazy(() => import('./pages/auth/PasswordResetPage'));
const PasswordResetRequestPage = lazy(() => import('./pages/auth/PasswordResetRequestPage'));
// El módulo no exporta por defecto; mapea el named export a default para React.lazy
const PublicSessionStudentsPage = lazy(() =>
  import('./public/PublicSessionStudentsPage').then((m) => ({
    default: m.PublicSessionStudentsPage,
  }))
);

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route
          path="/public/sesiones/:sessionId/alumnos"
          element={<PublicSessionStudentsPage />}
        />
        <Route path="/auth/password/forgot" element={<PasswordResetRequestPage />} />
        <Route path="/auth/password/reset" element={<PasswordResetPage />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
    </Suspense>
  );
}

function LoginRoute() {
  const location = useLocation();
  const { isLoading, isAuthenticated, permissions, hasPermission } = useAuth();
  const preferredPath = useMemo(() => computeDefaultPath(permissions), [permissions]);

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (isAuthenticated) {
    const target =
      preferredPath !== '/' && hasPermission(preferredPath)
        ? preferredPath
        : '/';
    return <Navigate to={target} replace state={location.state} />;
  }

  return <LoginPage />;
}

function ProtectedApp() {
  const location = useLocation();
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    preloadLoginPage().catch(() => {
      // Silenciar errores de precarga; el lazy import los gestionará si ocurren durante la navegación real.
    });
  }, []);

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <AuthenticatedApp />;
}

function FullPageLoader() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <Spinner animation="border" role="status" />
    </div>
  );
}
