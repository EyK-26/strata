/** Legacy renderer imports remain compatible; generation uses artifact modules directly. */

export {
  renderConfigProvider,
  renderConfigTs,
  renderCreateAppTs,
  renderOutboxRegistryTs,
  renderPolicyProvider,
  renderPreloadTs,
  renderProvidersIndex,
  renderQueueProvider,
  renderRoutesTs,
  renderScheduleTs,
  renderViewProvider,
} from "./renderBootstrap.ts";
export {
  renderCliOpenApiTs,
  renderCliOutboxWorkTs,
  renderCliQueueFailedTs,
  renderCliQueueWorkTs,
  renderCliRegisterTs,
  renderCliScheduleRunTs,
} from "./renderCli.ts";
export { renderDatabaseTs, renderEnsureDatabaseTs, renderSidecarsTs } from "./renderDatabase.ts";
export {
  dialectFragments,
  renderAccountStateMigration,
  renderFreshTs,
  renderMigrateTs,
  renderMigrationRuntimeTs,
  renderOutboxMigration,
  renderRollbackTs,
  renderSeedTs,
  renderStarterSchemaMigration,
  renderStatusTs,
} from "./renderMigrations.ts";
export {
  renderApiTokenModel,
  renderAuthOneTimeTokenModel,
  renderModelsRegister,
  renderNoteModel,
  renderUserModel,
} from "./renderModels.ts";
