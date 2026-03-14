import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

export interface Credentials {
  username: string;
  password: string;
}

interface AuthContextValue {
  credentials: Credentials | null;
  login: (username: string, password: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'admin_credentials';

function loadStored(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Credentials;
    if (parsed?.username && parsed?.password) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function saveStored(c: Credentials | null) {
  if (c) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials | null>(loadStored);

  const login = useCallback((username: string, password: string) => {
    const c = { username, password };
    setCredentials(c);
    saveStored(c);
  }, []);

  const logout = useCallback(() => {
    setCredentials(null);
    saveStored(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        credentials,
        login,
        logout,
        isAuthenticated: !!credentials,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
