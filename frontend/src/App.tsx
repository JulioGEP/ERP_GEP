import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from 'react-bootstrap';
import { useAuth } from './shared/auth/AuthContext';

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const PublicSessionStudentsPage = lazy(() => import('./public/PublicSessionStudentsPage'));

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/public/sesiones/:sessionId/alumnos" element={<PublicSessionStudentsPage />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
    </Suspense>
  );
}

function LoginRoute() {
  const location = useLocation();
  const { status, hasPermission, getDefaultPath } = useAuth();

  if (status === 'loading') {
    return <FullPageLoader />;
  }

  if (status === 'authenticated') {
    const preferredPath = getDefaultPath();
    const target = preferredPath !== '/' && hasPermission(preferredPath) ? preferredPath : '/';
    return <Navigate to={target} replace state={location.state} />;
  }

  return <LoginPage />;
}

function ProtectedApp() {
  const location = useLocation();
  const { status } = useAuth();

  if (status === 'loading') {
    return <FullPageLoader />;
  }

  if (status === 'unauthenticated') {
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
