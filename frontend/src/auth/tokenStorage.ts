const STORAGE_KEY = 'erp-gep-auth-token';

type Listener = (token: string | null) => void;

let currentToken: string | null = null;
const listeners = new Set<Listener>();

function readTokenFromStorage(): string | null {
  if (typeof window === 'undefined') {
    return currentToken;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim().length) {
      return stored;
    }
  } catch (error) {
    console.warn('[auth] No se pudo leer el token almacenado', error);
  }

  return null;
}

function persistToken(token: string | null) {
  if (typeof window === 'undefined') {
    currentToken = token;
    return;
  }

  try {
    if (token && token.length) {
      window.localStorage.setItem(STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.warn('[auth] No se pudo actualizar el token almacenado', error);
  }
}

export function getStoredAuthToken(): string | null {
  if (currentToken === null) {
    currentToken = readTokenFromStorage();
  }
  return currentToken;
}

export function setStoredAuthToken(token: string | null) {
  currentToken = token && token.trim().length ? token : null;
  persistToken(currentToken);
  listeners.forEach((listener) => {
    try {
      listener(currentToken);
    } catch (error) {
      console.error('[auth] Error notificando cambio de token', error);
    }
  });
}

export function subscribeAuthToken(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  currentToken = readTokenFromStorage();
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    const value = typeof event.newValue === 'string' ? event.newValue : null;
    currentToken = value && value.trim().length ? value : null;
    listeners.forEach((listener) => {
      try {
        listener(currentToken);
      } catch (error) {
        console.error('[auth] Error notificando cambio de token (storage)', error);
      }
    });
  });
}

export { STORAGE_KEY as AUTH_TOKEN_STORAGE_KEY };
