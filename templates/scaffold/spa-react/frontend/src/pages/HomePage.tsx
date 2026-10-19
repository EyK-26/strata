import { useAuth } from "../auth/AuthContext";
import { AUTH_CONFIG } from "../auth/config";
import { TENANCY_ENABLED } from "../config";
import { notesModuleExample } from "../examples/notes";
export default function HomePage() {
  const { user } = useAuth();
  return (
    <section>
      <h1>{AUTH_CONFIG.transport === "headers" ? "Development identity selected" : "Signed in"}</h1>
      <p className="hint">
        {AUTH_CONFIG.transport === "headers"
          ? "Request identity headers are enabled only for local development. There is no account profile endpoint in this mode."
          : AUTH_CONFIG.transport === "jwt"
            ? "This page reads GET /api/user with a memory-only JWT. Reloading requires sign-in again."
            : `This page reads GET /api/v1/auth/me with ${AUTH_CONFIG.transport === "cookie" ? "the HttpOnly session cookie" : "a memory-only API token"}.`}
      </p>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <th>ID</th>
              <td>{user?.id ?? "—"}</td>
            </tr>
            <tr>
              <th>Name</th>
              <td>{user?.name ?? "—"}</td>
            </tr>
            <tr>
              <th>Email</th>
              <td>{user?.email ?? "—"}</td>
            </tr>
            <tr>
              <th>Role</th>
              <td>
                <code>{user?.role ?? "—"}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>Starter-only example</h2>
      <p>
        This app has no notes API yet. Add an explicit module under <code>src/modules/</code> to
        expose your own application resources through the ORM.
      </p>
      <pre className="card">
        <code>{notesModuleExample(TENANCY_ENABLED)}</code>
      </pre>
      <p className="hint">
        Then fetch it here with <code>apiFetch("/notes")</code>. The <code>notes</code> table
        already exists after <code>bun run db:migrate</code>. Application authorization and tenant
        scope remain required for real business data.
      </p>
    </section>
  );
}
