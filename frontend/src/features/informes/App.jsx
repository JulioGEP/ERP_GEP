import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import Form from "./components/Form";
import Preview from "./components/Preview";
import Home from "./components/Home";

export const AuthContext = createContext({
  isAuthenticated: false,
  user: null,
  expiresAt: null,
  login: () => {},
  logout: () => {},
});

const AUTH_STORAGE_KEY = "gep-informes-auth";
const SESSION_DURATION_MS = 3 * 60 * 60 * 1000;

const createDefaultAuthState = () => ({
  isAuthenticated: false,
  user: null,
  expiresAt: null,
});

export default function App() {
  const [authState, setAuthState] = useState(() => {
    if (typeof window === "undefined") {
      return createDefaultAuthState();
    }

    const stored = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) {
      return createDefaultAuthState();
    }

    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        const expiresAt =
          typeof parsed.expiresAt === "number" ? parsed.expiresAt : null;

        if (expiresAt && expiresAt > Date.now()) {
          return {
            isAuthenticated: Boolean(parsed.isAuthenticated),
            user: parsed.user || null,
            expiresAt,
          };
        }

        window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (error) {
      console.warn(
        "No se pudo recuperar el estado de autenticación almacenado",
        error,
      );
    }

    return createDefaultAuthState();
  });
  const [screen, setScreen] = useState('home');
  const [formacion, setFormacion] = useState(null);
  const [simulacro, setSimulacro] = useState(null);
  const [preventivo, setPreventivo] = useState(null);
  const [preventivoEbro, setPreventivoEbro] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (authState.isAuthenticated && authState.expiresAt) {
      if (authState.expiresAt <= Date.now()) {
        window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }

      window.sessionStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          isAuthenticated: authState.isAuthenticated,
          user: authState.user,
          expiresAt: authState.expiresAt,
        }),
      );
    } else {
      window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [authState]);

  const login = useCallback((userData) => {
    setAuthState({
      isAuthenticated: true,
      user: userData,
      expiresAt: Date.now() + SESSION_DURATION_MS,
    });
  }, []);

  const logout = useCallback(() => {
    setAuthState(createDefaultAuthState());
    setScreen('home');
    setFormacion(null);
    setSimulacro(null);
    setPreventivo(null);
    setPreventivoEbro(null);
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !authState.isAuthenticated ||
      !authState.expiresAt
    ) {
      return;
    }

    const remainingTime = authState.expiresAt - Date.now();

    if (remainingTime <= 0) {
      logout();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      logout();
    }, remainingTime);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authState.isAuthenticated, authState.expiresAt, logout]);

  const authValue = useMemo(() => ({
    ...authState,
    login,
    logout,
  }), [authState, login, logout]);

  return (
    <AuthContext.Provider value={authValue}>
      <div className="container py-4">
        {authState.isAuthenticated ? (
          <>
            <div className="d-flex justify-content-end align-items-center gap-3 mb-4">
              <small className="text-muted mb-0">
                Sesión iniciada como <strong>{authState.user?.email}</strong>
              </small>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={logout}>
                Cerrar sesión
              </button>
            </div>
            {screen === 'home' && (
              <Home onSelect={(tipo) => setScreen(`${tipo}-form`)} />
            )}
            {screen === 'formacion-form' && (
              <Form
                initial={formacion}
                title="Informe de Formación"
                type="formacion"
                onChooseAnother={() => setScreen('home')}
                onNext={(data) => {
                  setFormacion(data);
                  setScreen('formacion-preview');
                }}
              />
            )}
            {screen === 'formacion-preview' && (
              <Preview
                data={formacion}
                title="Informe de Formación"
                type="formacion"
                onBack={() => setScreen('formacion-form')}
              />
            )}
            {screen === 'simulacro-form' && (
              <Form
                initial={simulacro}
                title="Informe de Simulacro"
                type="simulacro"
                onChooseAnother={() => setScreen('home')}
                onNext={(data) => {
                  setSimulacro(data);
                  setScreen('simulacro-preview');
                }}
              />
            )}
            {screen === 'simulacro-preview' && (
              <Preview
                data={simulacro}
                title="Informe de Simulacro"
                type="simulacro"
                onBack={() => setScreen('simulacro-form')}
              />
            )}
            {screen === 'preventivo-form' && (
              <Form
                initial={preventivo}
                title="Informe de Preventivos"
                type="preventivo"
                onChooseAnother={() => setScreen('home')}
                onNext={(data) => {
                  setPreventivo(data);
                  setScreen('preventivo-preview');
                }}
              />
            )}
            {screen === 'preventivo-preview' && (
              <Preview
                data={preventivo}
                title="Informe de Preventivos"
                type="preventivo"
                onBack={() => setScreen('preventivo-form')}
              />
            )}
            {screen === 'preventivo-ebro-form' && (
              <Form
                initial={preventivoEbro}
                title="Informe Recurso Preventivo EBRO"
                type="preventivo-ebro"
                onChooseAnother={() => setScreen('home')}
                onNext={(data) => {
                  setPreventivoEbro(data);
                  setScreen('preventivo-ebro-preview');
                }}
              />
            )}
            {screen === 'preventivo-ebro-preview' && (
              <Preview
                data={preventivoEbro}
                title="Informe Recurso Preventivo EBRO"
                type="preventivo-ebro"
                onBack={() => setScreen('preventivo-ebro-form')}
              />
            )}
          </>
        ) : (
          <Login />
        )}
      </div>
    </AuthContext.Provider>
  );
}