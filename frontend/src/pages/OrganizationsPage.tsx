import { useCallback, useEffect, useState } from "react";
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
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const loadOrganizations = useCallback(async () => {
    if (!token) {
      return;
    }

    const body = await apiFetch<PaginatedOrganizations>("/organizations", { token });
    setOrganizations(body.data);
  }, [token]);

  useEffect(() => {
    loadOrganizations().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load organizations");
    });
  }, [loadOrganizations]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      return;
    }

    setError(null);

    try {
      await apiFetch("/organizations", {
        method: "POST",
        token,
        body: JSON.stringify({ name, slug }),
      });
      setName("");
      setSlug("");
      await loadOrganizations();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Create failed");
    }
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || editingId === null) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/organizations/${editingId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ name: editName, slug: editSlug }),
      });
      setEditingId(null);
      await loadOrganizations();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Update failed");
    }
  }

  async function handleDelete(organization: Organization) {
    if (!token || !window.confirm(`Delete ${organization.name}?`)) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/organizations/${organization.id}`, {
        method: "DELETE",
        token,
      });
      await loadOrganizations();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  }

  function startEdit(organization: Organization) {
    setEditingId(organization.id);
    setEditName(organization.name);
    setEditSlug(organization.slug);
  }

  return (
    <section>
      <h1>Organizations</h1>
      <p className="hint">{organizations.length} loaded from the JSON API.</p>

      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <h2>Create organization</h2>
        <form onSubmit={handleCreate} className="stack-form">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Slug
            <input value={slug} onChange={(event) => setSlug(event.target.value)} required />
          </label>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id}>
                <td>{organization.name}</td>
                <td>
                  <code>{organization.slug}</code>
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => startEdit(organization)}
                  >
                    Edit
                  </button>{" "}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleDelete(organization)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingId !== null ? (
        <div className="card">
          <h2>Edit organization</h2>
          <form onSubmit={handleUpdate} className="stack-form">
            <label>
              Name
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                required
              />
            </label>
            <label>
              Slug
              <input
                value={editSlug}
                onChange={(event) => setEditSlug(event.target.value)}
                required
              />
            </label>
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      <p>
        Continue to <Link to="/projects">projects</Link> or <Link to="/tasks">tasks</Link>.
      </p>
    </section>
  );
}
