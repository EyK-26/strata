import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Task {
  id: number;
  title: string;
  status: string;
  project_id: number;
}

interface PaginatedTasks {
  data: Task[];
}

export default function TasksPage() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    apiFetch<PaginatedTasks>("/tasks", { token })
      .then((body) => setTasks(body.data))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Failed to load tasks");
      });
  }, [token]);

  return (
    <section>
      <h1>Tasks</h1>
      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td>{task.status}</td>
                <td>{task.project_id}</td>
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
