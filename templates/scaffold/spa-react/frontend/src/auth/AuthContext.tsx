import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type AuthUser,
  loadProfile,
  onAuthInvalidated,
  selectDevelopmentIdentity,
  signIn,
  signOut,
} from "../api/client";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  chooseIdentity: (id: string, role: string) => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => onAuthInvalidated(() => setUser(null)), []);
  useEffect(() => {
    let active = true;
    loadProfile()
      .then((profile) => {
        if (active) setUser(profile);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    setUser(await signIn(email, password, mfaCode));
  }, []);
  const logout = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);
  const chooseIdentity = useCallback((id: string, role: string) => {
    setUser(selectDevelopmentIdentity(id, role));
  }, []);
  const value = useMemo(
    () => ({ user, loading, login, logout, chooseIdentity }),
    [user, loading, login, logout, chooseIdentity],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export type { AuthUser };
export { AuthProvider, useAuth };
