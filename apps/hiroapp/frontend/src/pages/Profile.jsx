import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function ProfilePage() {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/apply/me")
      .then((user) =>
        setForm({
          first_name: user.first_name ?? "",
          last_name: user.last_name ?? "",
          email: user.email ?? "",
        }),
      )
      .catch((err) => setError(err.message));
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await api("/api/apply/profile", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setMessage("Saved.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h1>Profile</h1>
      <form className="stack-form" onSubmit={onSubmit}>
        <label>
          First name
          <input
            value={form.first_name}
            onChange={(event) => setForm({ ...form, first_name: event.target.value })}
          />
        </label>
        <label>
          Last name
          <input
            value={form.last_name}
            onChange={(event) => setForm({ ...form, last_name: event.target.value })}
          />
        </label>
        <label>
          Email
          <input
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <button type="submit">Save</button>
      </form>
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
