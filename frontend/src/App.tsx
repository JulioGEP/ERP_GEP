// src/App.tsx
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { useAuth } from './context/AuthContext';

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
const PublicTrainerSessionInvitePage = lazy(() =>
  import('./public/PublicTrainerSessionInvitePage').then((m) => ({
    default: m.PublicTrainerSessionInvitePage,
  }))
);
const PublicTrainerVariantInvitePage = lazy(() =>
  import('./public/PublicTrainerVariantInvitePage').then((m) => ({
    default: m.PublicTrainerVariantInvitePage,
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
        <Route
          path="/public/formadores/sesiones/:token"
          element={<PublicTrainerSessionInvitePage />}
        />
        <Route
          path="/public/formadores/variantes/:token"
          element={<PublicTrainerVariantInvitePage />}
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
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace state={location.state} />;
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
