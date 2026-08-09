import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch } from "../api/client";
import { clearToken, readToken, writeToken } from "./tokenStorage";

interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(Boolean(readToken()));

  const loadProfile = useCallback(async (activeToken: string) => {
    const profile = await apiFetch<AuthUser>("/auth/me", { token: activeToken });
    setUser(profile);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    loadProfile(token)
      .catch(() => {
        clearToken();
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadProfile, token]);

  const login = useCallback(
    async (email: string, password: string) => {
      const body = await apiFetch<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      writeToken(body.token);
      setToken(body.token);
      await loadProfile(body.token);
    },
    [loadProfile],
  );

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      login,
      logout,
    }),
    [loading, login, logout, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}

export type { AuthUser };
export { AuthProvider, useAuth };
