import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function BoardPage() {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/apply/positions")
      .then((rows) => setJobs(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1>Open jobs</h1>
      {error ? <p className="error">{error}</p> : null}
      {jobs.map((job) => (
        <article className="card" key={job.id}>
          <h2>{job.name}</h2>
          <p>{job.description}</p>
          <Link to={`/jobs/${job.position_id}`}>Apply</Link>
        </article>
      ))}
      {jobs.length === 0 && !error ? <p>No published jobs.</p> : null}
    </div>
  );
}
