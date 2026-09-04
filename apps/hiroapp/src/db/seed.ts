import { connectHiroappDatabase } from "./connect.ts";
import { runAppSeeders } from "./seeder.ts";

await connectHiroappDatabase();
await runAppSeeders();
