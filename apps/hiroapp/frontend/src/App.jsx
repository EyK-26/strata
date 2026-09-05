import React from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { clearToken, getToken } from "./api.js";
import ApplicationPage from "./pages/Application.jsx";
import ApplicationsPage from "./pages/Applications.jsx";
import ApplyPage from "./pages/Apply.jsx";
import BoardPage from "./pages/Board.jsx";
import LoginPage from "./pages/Login.jsx";
import ProfilePage from "./pages/Profile.jsx";

function Layout({ children }) {
  const navigate = useNavigate();
  const signedIn = Boolean(getToken());

  function logout() {
    fetch("/api/apply/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${getToken()}`, accept: "application/json" },
    }).finally(() => {
      clearToken();
      navigate("/login");
    });
  }

  return (
    <div className="shell">
      <nav className="topnav">
        <Link to="/">Jobs</Link>
        {signedIn ? <Link to="/applications">Applications</Link> : null}
        {signedIn ? <Link to="/profile">Profile</Link> : <Link to="/login">Sign in</Link>}
        <a href="/login">Staff sign-in</a>
        {signedIn ? (
          <button type="button" onClick={logout}>
            Log out
          </button>
        ) : null}
      </nav>
      {children}
    </div>
  );
}

function RequireToken({ children }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireToken>
              <BoardPage />
            </RequireToken>
          }
        />
        <Route
          path="/jobs/:positionId"
          element={
            <RequireToken>
              <ApplyPage />
            </RequireToken>
          }
        />
        <Route
          path="/applications"
          element={
            <RequireToken>
              <ApplicationsPage />
            </RequireToken>
          }
        />
        <Route
          path="/applications/:id"
          element={
            <RequireToken>
              <ApplicationPage />
            </RequireToken>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireToken>
              <ProfilePage />
            </RequireToken>
          }
        />
      </Routes>
    </Layout>
  );
}
