import { useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="hint">Loading session…</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AppShell() {
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  return (
    <div className="app-shell">
      <header className="site-header">
        <strong>Strata SPA</strong>
        <nav>
          <Link to="/">Home</Link>
          {user ? (
            <>
              <span className="hint">{user.email ?? `User ${user.id}`}</span>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setLogoutError(null);
                  void logout().catch(() =>
                    setLogoutError("Sign-out could not complete. Try again."),
                  );
                }}
              >
                Sign out
              </button>
            </>
          ) : null}
        </nav>
      </header>

      {logoutError ? <p role="alert">{logoutError}</p> : null}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
