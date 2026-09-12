import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";

process.env.DATABASE_URL ??=
  "postgresql://strata_app:dev-strata-app-change-me@localhost:5432/hiroapp";
process.env.FRONTEND_MODE ??= "server-htmx";
process.env.SPA_PREFIX ??= "/app";
process.env.CACHE_DRIVER ??= "redis";
process.env.QUEUE_DRIVER ??= "redis";
process.env.MAIL_DRIVER ??= "smtp";
process.env.TENANCY_DRIVER ??= "rls";
configureModulesDirectory(join(import.meta.dir, "../modules"));
