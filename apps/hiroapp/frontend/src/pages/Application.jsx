import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

export default function ApplicationPage() {
  const { id } = useParams();
  const [interviews, setInterviews] = useState([]);
  const [offers, setOffers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api("/api/apply/interviews"), api("/api/apply/offers")])
      .then(([interviewPayload, offerPayload]) => {
        const applicationId = Number(id);
        setInterviews(
          (interviewPayload.data ?? []).filter((row) => Number(row.application_id) === applicationId),
        );
        setOffers((offerPayload.data ?? []).filter((row) => Number(row.application_id) === applicationId));
      })
      .catch((err) => setError(err.message));
  }, [id]);

  return (
    <div>
      <h1>Application #{id}</h1>
      {error ? <p className="error">{error}</p> : null}
      <section className="card">
        <h2>Interviews</h2>
        {interviews.map((row) => (
          <p key={row.id}>
            {row.scheduled_at} · {row.status} · {row.place}
          </p>
        ))}
        {interviews.length === 0 ? <p>None yet.</p> : null}
      </section>
      <section className="card">
        <h2>Offers</h2>
        {offers.map((row) => (
          <p key={row.id}>
            {row.status} · {row.salary}
          </p>
        ))}
        {offers.length === 0 ? <p>None yet.</p> : null}
      </section>
    </div>
  );
}
