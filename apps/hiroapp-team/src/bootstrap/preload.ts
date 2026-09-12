import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";

process.env.DATABASE_URL ??=
  "postgresql://postgres:dev-postgres-change-me@localhost:5432/hiroapp_team";
process.env.FRONTEND_MODE ??= "server-htmx";
process.env.SPA_PREFIX ??= "/app";
process.env.CACHE_DRIVER ??= "redis";
process.env.QUEUE_DRIVER ??= "redis";
process.env.MAIL_DRIVER ??= "log";
process.env.TENANCY_DRIVER ??= "none";
configureModulesDirectory(join(import.meta.dir, "../modules"));
