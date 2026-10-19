import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AUTH_CONFIG } from "../auth/config";
export default function LoginPage() {
  const { login, user, chooseIdentity } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [id, setId] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (user) return <Navigate to="/" replace />;
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (AUTH_CONFIG.transport === "headers") chooseIdentity(id, role);
      else await login(email, password, mfaCode);
      navigate("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }
  const development = AUTH_CONFIG.transport === "headers";
  return (
    <section className="card">
      <h1>{development ? "Development identity" : "Sign in"}</h1>
      <p className="hint">
        {development
          ? "Development only. Select request headers for local testing; this is not a persisted account or production sign-in. The backend must allow AUTH_DEV_HEADERS in a local environment."
          : AUTH_CONFIG.transport === "cookie"
            ? "Enter your account email and password."
            : "Enter your account email and password. The bearer credential stays in memory; reloading requires sign-in again."}
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="stack-form" onSubmit={onSubmit}>
        {development ? (
          <>
            <label>
              User ID
              <input
                name="userId"
                inputMode="numeric"
                pattern="[0-9]+"
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {AUTH_CONFIG.mfa ? (
              <label>
                Authenticator or recovery code
                <input
                  name="mfa_code"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                />
              </label>
            ) : null}
          </>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : development ? "Use development identity" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
