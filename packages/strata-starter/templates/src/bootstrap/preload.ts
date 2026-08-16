import { join } from "node:path";
import { configureModulesDirectory } from "@getstrata/bootstrap/discoverModules";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/{{PROJECT_NAME}}";
configureModulesDirectory(join(import.meta.dir, "../modules"));
