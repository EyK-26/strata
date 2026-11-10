import { createServiceToken } from "@getstrata/core/contracts/token";
import type { DatabaseManager } from "./manager";
import type { DatabaseSession } from "./session";

/** Canonical execution session; constructors and business code receive its narrow value. */
const DATABASE_SESSION_TOKEN = createServiceToken<DatabaseSession>("core.database.session");
/** Internal application assembly; callers never use it as an execution facade. */
const DATABASE_MANAGER_TOKEN = createServiceToken<DatabaseManager>("core.database.manager");

export { DATABASE_MANAGER_TOKEN, DATABASE_SESSION_TOKEN };
