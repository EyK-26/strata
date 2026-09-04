import { bindDatabase } from "../bootstrap/database.ts";
import { runAppSeeders } from "./seeder.ts";

bindDatabase();
await runAppSeeders();
