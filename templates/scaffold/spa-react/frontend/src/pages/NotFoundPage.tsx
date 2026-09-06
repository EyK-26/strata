import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <section className="card">
      <h1>Not found</h1>
      <p>
        Return <Link to="/">home</Link>.
      </p>
    </section>
  );
}
