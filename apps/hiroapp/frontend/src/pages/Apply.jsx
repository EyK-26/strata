import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";

export default function ApplyPage() {
  const { positionId } = useParams();
  const navigate = useNavigate();
  const [cover, setCover] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/apply/applications", {
        method: "POST",
        body: JSON.stringify({
          position_id: Number(positionId),
          attachment_text: cover || null,
          attachment_file: null,
        }),
      });
      navigate("/applications");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h1>Apply</h1>
      <form className="stack-form" onSubmit={onSubmit}>
        <label>
          Cover note
          <textarea value={cover} onChange={(event) => setCover(event.target.value)} />
        </label>
        <button type="submit">Submit application</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
