import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Task {
  id: number;
  title: string;
  status: string;
  priority: number;
  project_id: number;
}

interface Attachment {
  id: number;
  task_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  download_url: string;
}

interface Comment {
  id: number;
  task_id: number;
  body: string;
}

interface PaginatedAttachments {
  data: Attachment[];
}

interface PaginatedComments {
  data: Comment[];
}

export default function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const taskId = Number(id);
  const { token } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadTask = useCallback(async () => {
    if (!token || !Number.isInteger(taskId)) {
      return;
    }

    const body = await apiFetch<Task>(`/tasks/${taskId}`, { token });
    setTask(body);
    setTitle(body.title);
    setStatus(body.status);
    setPriority(String(body.priority));
  }, [taskId, token]);

  const loadAttachments = useCallback(async () => {
    if (!token || !Number.isInteger(taskId)) {
      return;
    }

    const body = await apiFetch<PaginatedAttachments>(`/tasks/${taskId}/attachments`, { token });
    setAttachments(body.data);
  }, [taskId, token]);

  const loadComments = useCallback(async () => {
    if (!token || !Number.isInteger(taskId)) {
      return;
    }

    const body = await apiFetch<PaginatedComments>(`/tasks/${taskId}/comments`, { token });
    setComments(body.data);
  }, [taskId, token]);

  useEffect(() => {
    loadTask().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load task");
    });
    loadAttachments().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load attachments");
    });
    loadComments().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load comments");
    });
  }, [loadAttachments, loadComments, loadTask]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !file) {
      return;
    }

    const form = event.currentTarget;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      await apiFetch(`/tasks/${taskId}/attachments`, {
        method: "POST",
        token,
        body: formData,
      });

      setFile(null);
      form.reset();
      await loadAttachments();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: number) {
    if (!token) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/attachments/${attachmentId}`, {
        method: "DELETE",
        token,
      });
      await loadAttachments();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          title,
          status,
          priority: Number(priority),
        }),
      });
      await loadTask();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Update failed");
    }
  }

  async function handleDeleteTask() {
    if (!token || !window.confirm("Delete this task?")) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: "DELETE",
        token,
      });
      navigate("/tasks");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  }

  async function handleCreateComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !commentBody.trim()) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/tasks/${taskId}/comments`, {
        method: "POST",
        token,
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      setCommentBody("");
      await loadComments();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Comment failed");
    }
  }

  async function handleUpdateComment(comment: Comment, body: string) {
    if (!token) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/comments/${comment.id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ body }),
      });
      await loadComments();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Comment update failed");
    }
  }

  async function handleDeleteComment(comment: Comment) {
    if (!token || !window.confirm("Delete this comment?")) {
      return;
    }

    setError(null);

    try {
      await apiFetch(`/comments/${comment.id}`, {
        method: "DELETE",
        token,
      });
      await loadComments();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Comment delete failed");
    }
  }

  if (!Number.isInteger(taskId)) {
    return <p className="error">Invalid task id.</p>;
  }

  return (
    <section>
      <h1>{task?.title ?? "Task"}</h1>
      {task ? <p className="hint">Status: {task.status}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <h2>Edit task</h2>
        <form onSubmit={handleUpdate} className="stack-form">
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
          <button type="submit">Save</button>
          <button type="button" className="secondary" onClick={handleDeleteTask}>
            Delete task
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Comments</h2>
        <form onSubmit={handleCreateComment} className="stack-form">
          <label>
            Add comment
            <textarea
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              rows={3}
              required
            />
          </label>
          <button type="submit">Post comment</button>
        </form>

        <ul className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <textarea
                defaultValue={comment.body}
                rows={3}
                onBlur={(event) => {
                  if (event.target.value !== comment.body) {
                    void handleUpdateComment(comment, event.target.value);
                  }
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => handleDeleteComment(comment)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Attachments</h2>
        <form onSubmit={handleUpload} className="stack-form">
          <label>
            File
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </label>
          <button type="submit" disabled={uploading || !file}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>

        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <a href={attachment.download_url}>{attachment.original_name}</a>
              <span className="hint">
                ({attachment.mime_type}, {attachment.size_bytes} bytes)
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => handleDeleteAttachment(attachment.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p>
        Back to <Link to="/tasks">tasks</Link>.
      </p>
    </section>
  );
}
