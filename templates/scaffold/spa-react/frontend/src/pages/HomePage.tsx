import { useAuth } from "../auth/AuthContext";

export default function HomePage() {
  const { user } = useAuth();

  return (
    <section>
      <h1>Signed in</h1>
      <p className="hint">
        This page reads <code>GET /api/v1/auth/me</code> with the HttpOnly session cookie. It is the
        only resource the generated backend serves, so it is the only one this page shows.
      </p>

      <div className="card">
        <table>
          <tbody>
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

      <h2>Add your first resource</h2>
      <p>
        Create a module under <code>src/modules/</code> and return routes from it. The kernel picks
        it up on the next boot.
      </p>

      <pre className="card">
        <code>{`// src/modules/notes/index.ts
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { getSql } from "../../bootstrap/database.ts";

const notesModule: AppModule = {
  name: "notes",
  order: 2,
  routes({ kernel }) {
    return {
      "/api/v1/notes": kernel.wrap("api", async () => {
        const rows = await getSql().unsafe<{ id: number; body: string }>(
          "SELECT id, body FROM notes ORDER BY id DESC",
        );
        return jsonResponse({ data: rows });
      }),
    };
  },
};

export default notesModule;`}</code>
      </pre>

      <p className="hint">
        Then fetch it here with <code>apiFetch("/notes")</code>. The <code>notes</code> table
        already exists after <code>bun run db:migrate</code>.
      </p>
    </section>
  );
}
