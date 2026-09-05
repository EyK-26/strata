export default {
  preload: "./src/bootstrap/preload.ts",
  server: "./src/bootstrap/server.ts",
  modulesDirectory: "./src/modules",
  migrate: "./src/db/migrate.ts",
  fresh: "./src/db/fresh.ts",
};
