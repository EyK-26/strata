import { SQL } from "bun";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not configured. Set DATABASE_URL before starting the app or running integration tests.",
  );
}

let db = new SQL(databaseUrl);

export default db;
