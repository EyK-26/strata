import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";

process.env.DATABASE_URL ??= "sqlite:./storage/app.sqlite";
process.env.FRONTEND_MODE ??= "api";
process.env.SPA_PREFIX ??= "/app";
process.env.CACHE_DRIVER ??= "array";
process.env.QUEUE_DRIVER ??= "sync";
process.env.MAIL_DRIVER ??= "log";
process.env.TENANCY_DRIVER ??= "none";
configureModulesDirectory(join(import.meta.dir, "../modules"));
