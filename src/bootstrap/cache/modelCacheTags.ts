import { discoverModules } from "../discoverModules";

function cacheTagsForModelWrite(tableName: string, action: string): string[] {
  const module = discoverModules().find((entry) => entry.tableName === tableName);
  const baseTags = module?.cacheTags ?? [`${tableName}s`];
  const isDelete = action === "deleted" || action === "force-deleted";
  const extraTags = isDelete ? (module?.cacheDeleteExtraTags ?? []) : [];

  return [...new Set([...baseTags, ...extraTags])];
}

function discoverModelTableNames(): string[] {
  return discoverModules()
    .map((module) => module.tableName)
    .filter((tableName): tableName is string => tableName !== undefined);
}

export { cacheTagsForModelWrite, discoverModelTableNames };
