import { bindDatabase } from "../bootstrap/database.ts";
import { ensureHiroappDatabase } from "./ensureDatabase.ts";

export async function connectHiroappDatabase() {
  await ensureHiroappDatabase();
  return bindDatabase();
}
