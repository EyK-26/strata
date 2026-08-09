import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Project {
  id: number;
  name: string;
}

interface Task {
  id: number;
  title: string;
  status: string;
  project_id: number;
  project?: Project;
}

interface PaginatedTasks {
  data: Task[];
}

interface PaginatedProjects {
  data: Project[];
}

export default function TasksPage() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("todo");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("0");

  const loadTasks = useCallback(async () => {
    if (!token) {
      return;
    }

    const body = await apiFetch<PaginatedTasks>("/tasks?include=project", { token });
    setTasks(body.data);
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    Promise.all([
      loadTasks(),
      apiFetch<PaginatedProjects>("/projects", { token }).then((body) => {
        setProjects(body.data);
        if (body.data[0]) {
          setProjectId(String(body.data[0].id));
        }
      }),
    ]).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load tasks");
    });
  }, [loadTasks, token]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      return;
    }

    setError(null);

    try {
      await apiFetch("/tasks", {
        method: "POST",
        token,
        body: JSON.stringify({
          project_id: Number(projectId),
          title,
          status,
          priority: Number(priority),
        }),
      });
      setTitle("");
      await loadTasks();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Create failed");
    }
  }

  return (
    <section>
      <h1>Tasks</h1>
      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <h2>Create task</h2>
        <form onSubmit={handleCreate} className="stack-form">
          <label>
            Project
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="todo">todo</option>
              <option value="in_progress">in_progress</option>
              <option value="done">done</option>
            </select>
          </label>
          <label>
            Priority
            <input
              type="number"
              min="0"
              max="5"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </label>
          <button type="submit">Create</button>
        </form>
      </div>

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
                <td>
                  <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                </td>
                <td>{task.status}</td>
                <td>{task.project?.name ?? task.project_id}</td>
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
