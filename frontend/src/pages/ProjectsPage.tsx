import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Organization {
  id: number;
  name: string;
}

interface Project {
  id: number;
  name: string;
  status: string;
  organization_id: number;
  organization?: Organization;
}

interface PaginatedProjects {
  data: Project[];
}

interface PaginatedOrganizations {
  data: Organization[];
}

export default function ProjectsPage() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("draft");
  const [organizationId, setOrganizationId] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("draft");

  const loadProjects = useCallback(async () => {
    if (!token) {
      return;
    }

    const body = await apiFetch<PaginatedProjects>("/projects?include=organization", { token });
    setProjects(body.data);
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    Promise.all([
      loadProjects(),
      apiFetch<PaginatedOrganizations>("/organizations", { token }).then((body) => {
        setOrganizations(body.data);
        if (body.data[0]) {
          setOrganizationId(String(body.data[0].id));
        }
      }),
    ]).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load projects");
    });
  }, [loadProjects, token]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      return;
    }

    setError(null);

    try {
      await apiFetch("/projects", {
        method: "POST",
        token,
        body: JSON.stringify({
          organization_id: Number(organizationId),
          name,
          status,
        }),
      });
      setName("");
      await loadProjects();
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
      await apiFetch(`/projects/${editingId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ name: editName, status: editStatus }),
      });
      setEditingId(null);
      await loadProjects();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Update failed");
    }
  }

  async function handleDelete(project: Project) {
    if (!token || !window.confirm(`Delete ${project.name}?`)) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/projects/${project.id}`, {
        method: "DELETE",
        token,
      });
      await loadProjects();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  }

  function startEdit(project: Project) {
    setEditingId(project.id);
    setEditName(project.name);
    setEditStatus(project.status);
  }

  return (
    <section>
      <h1>Projects</h1>
      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <h2>Create project</h2>
        <form onSubmit={handleCreate} className="stack-form">
          <label>
            Organization
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              required
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Organization</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>{project.status}</td>
                <td>{project.organization?.name ?? project.organization_id}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => startEdit(project)}>
                    Edit
                  </button>{" "}
                  <button type="button" className="secondary" onClick={() => handleDelete(project)}>
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
          <h2>Edit project</h2>
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
              Status
              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <button type="submit">Save</button>
            <button type="button" className="secondary" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      <p>
        Back to <Link to="/organizations">organizations</Link>.
      </p>
    </section>
  );
}
