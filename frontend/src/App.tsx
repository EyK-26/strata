import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import OrganizationsPage from "./pages/OrganizationsPage";
import ProjectsPage from "./pages/ProjectsPage";
import TaskDetailPage from "./pages/TaskDetailPage";
import TasksPage from "./pages/TasksPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();

  if (loading) {
    return <p className="hint">Loading session…</p>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AppShell() {
  const { user, token, loading, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="site-header">
        <strong>WorkHub SPA</strong>
        <nav>
          <Link to="/organizations">Organizations</Link>
          <Link to="/projects">Projects</Link>
          <Link to="/tasks">Tasks</Link>
          {loading ? (
            <span className="hint">Session…</span>
          ) : token && user ? (
            <>
              <span className="hint">{user.email}</span>
              <button type="button" className="secondary" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Navigate to="/organizations" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/organizations"
          element={
            <ProtectedRoute>
              <OrganizationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <ProjectsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <TasksPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks/:id"
          element={
            <ProtectedRoute>
              <TaskDetailPage />
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
