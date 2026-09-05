import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function ApplicationsPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/apply/applications")
      .then((payload) => setRows(payload.data ?? []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1>Your applications</h1>
      {error ? <p className="error">{error}</p> : null}
      {rows.map((row) => (
        <article className="card" key={row.id}>
          <p>Application #{row.id}</p>
          <p>Status {row.status_id}</p>
          <Link to={`/applications/${row.id}`}>Details</Link>
        </article>
      ))}
    </div>
  );
}
