import type { AppModule } from "../contracts";

function cacheTagsForModelWrite(
  tableName: string,
  action: string,
  modules: readonly AppModule[],
): string[] {
  const module = modules.find((entry) => entry.tableName === tableName);
  const baseTags = module?.cacheTags ?? [tableName.endsWith("s") ? tableName : `${tableName}s`];
  const extras =
    action === "deleted" || action === "force-deleted" ? (module?.cacheDeleteExtraTags ?? []) : [];
  return [...new Set([...baseTags, ...extras])];
}
function discoverModelTableNames(modules: readonly AppModule[]): string[] {
  return modules
    .map((module) => module.tableName)
    .filter((name): name is string => name !== undefined);
}

export { cacheTagsForModelWrite, discoverModelTableNames };
