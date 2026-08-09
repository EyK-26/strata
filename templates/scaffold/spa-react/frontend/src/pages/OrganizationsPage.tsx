import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Organization {
  id: number;
  name: string;
  slug: string;
}

interface PaginatedOrganizations {
  data: Organization[];
  meta: {
    total: number;
  };
}

export default function OrganizationsPage() {
  const { token } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    apiFetch<PaginatedOrganizations>("/organizations", { token })
      .then((body) => setOrganizations(body.data))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Failed to load organizations");
      });
  }, [token]);

  return (
    <section>
      <h1>Organizations</h1>
      <p className="hint">{organizations.length} loaded from the JSON API.</p>

      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id}>
                <td>{organization.name}</td>
                <td>
                  <code>{organization.slug}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Continue to <Link to="/projects">projects</Link> or <Link to="/tasks">tasks</Link>.
      </p>
    </section>
  );
}
