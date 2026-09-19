export default {
  preload: "./src/bootstrap/preload.ts",
  server: "./src/bootstrap/server.ts",
  modulesDirectory: "./src/modules",
  commands: "./src/cli/register.ts",
  migrate: "./src/db/migrate.ts",
  fresh: "./src/db/fresh.ts",
};
