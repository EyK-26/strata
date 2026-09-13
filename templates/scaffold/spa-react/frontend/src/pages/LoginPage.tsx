import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.test");
  const [password, setPassword] = useState("StrataDemo!ChangeMe");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(email, password);
      navigate("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h1>Sign in</h1>
      <p className="hint">
        Seeded users are <code>demo@example.com</code> and <code>admin@example.test</code>, password
        <code>StrataDemo!ChangeMe</code>.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <form className="stack-form" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
