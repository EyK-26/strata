import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Project {
  id: number;
  name: string;
  status: string;
  organization_id: number;
}

interface PaginatedProjects {
  data: Project[];
}

export default function ProjectsPage() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    apiFetch<PaginatedProjects>("/projects?include=organization", { token })
      .then((body) => setProjects(body.data))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Failed to load projects");
      });
  }, [token]);

  return (
    <section>
      <h1>Projects</h1>
      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Organization</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>{project.status}</td>
                <td>{project.organization_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Back to <Link to="/organizations">organizations</Link>.
      </p>
    </section>
  );
}
