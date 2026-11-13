import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineFactory, Factory } from "@getstrata/core/database/factory";
import * as core from "../../src/framework/public-api.ts";

describe("@getstrata/core public API", () => {
  test("exports relationship helpers for application repositories", () => {
    expect(typeof core.hasMany).toBe("function");
    expect(typeof core.hasOne).toBe("function");
    expect(typeof core.belongsTo).toBe("function");
    expect(typeof core.belongsToMany).toBe("function");
    expect(typeof core.indexHasManyRelation).toBe("function");
    expect(typeof core.indexHasOneRelation).toBe("function");
    expect(typeof core.indexBelongsToRelation).toBe("function");
    expect(typeof core.indexBelongsToManyRelation).toBe("function");
  });

  test("exports explicit bound Model definition helpers", () => {
    expect(typeof core.Model).toBe("function");
    expect(typeof core.defineModel).toBe("function");
    expect(typeof core.defineRepository).toBe("function");
    expect(typeof core.createDatabaseBindings).toBe("function");
    expect("bootModels" in core).toBe(false);
    expect("registerModelRepository" in core).toBe(false);
    expect(typeof core.hydrateValue).toBe("function");
    expect(typeof core.filterMassAssignable).toBe("function");
    expect(typeof core.HasManyRelationQuery).toBe("function");
    expect(typeof core.HasOneRelationQuery).toBe("function");
    expect(typeof core.BelongsToRelationQuery).toBe("function");
    expect(typeof core.BelongsToManyRelationQuery).toBe("function");
    expect(typeof core.Factory).toBe("function");
    expect(core.Factory).toBe(Factory);
    expect(core.defineFactory).toBe(defineFactory);
    expect(typeof core.singularize).toBe("function");
  });

  test("exposes eager-loading methods on BaseRepository prototype", () => {
    expect(typeof BaseRepository.prototype.loadHasManyForParents).toBe("function");
    expect(typeof BaseRepository.prototype.loadBelongsToForParents).toBe("function");
    expect(typeof BaseRepository.prototype.findByHasManyRelation).toBe("function");
    expect(typeof BaseRepository.prototype.query).toBe("function");
  });

  test("exports RepositoryQuery for chainable with() loading", () => {
    expect(typeof core.RepositoryQuery).toBe("function");
    expect(typeof core.projectPluck).toBe("function");
    expect(typeof core.uniqueColumnSelect).toBe("function");
    expect(typeof core.RepositoryQuery.prototype.pluck).toBe("function");
    expect(typeof core.RepositoryQuery.prototype.value).toBe("function");
  });

  test("exports membership lookup used by published bootstrap", () => {
    expect(typeof core.resolveMembershipService).toBe("function");
    expect(typeof core.runWithMembershipContext).toBe("function");
  });

  test("exports seeder runner helpers", () => {
    expect(typeof core.runSeedersFromDirectory).toBe("function");
    expect(typeof core.loadSeedersFromDirectory).toBe("function");
  });

  test("exports API resource helpers", () => {
    expect(typeof core.serializeDate).toBe("function");
    expect(typeof core.toResourceCollection).toBe("function");
    expect(typeof core.JsonResource).toBe("function");
    expect(typeof core.ResourceCollection).toBe("function");
    expect(typeof core.whenLoaded).toBe("function");
    expect(typeof core.MorphManyRelationQuery).toBe("function");
    expect(typeof core.MorphToRelationQuery).toBe("function");
  });

  test("exports scheduler and graceful shutdown helpers", () => {
    expect(typeof core.runDueScheduledTasks).toBe("function");
    expect(typeof core.installGracefulShutdownSignals).toBe("function");
    expect(typeof core.securedBindRouteModelByKey).toBe("function");
  });

  test("exports admin resource registry and queue metrics helpers", () => {
    expect(typeof core.AdminResourceRegistry).toBe("function");
    expect(typeof core.formatAdminValue).toBe("function");
    expect(typeof core.collectQueueMetrics).toBe("function");
    expect(typeof core.FailedJobService).toBe("function");
    expect(typeof core.createStorageDriver).toBe("function");
    expect("registerDefaultDatabasePool" in core).toBe(false);
    expect("getBoundDatabaseConnection" in core).toBe(false);
    expect("resetBoundDatabaseConnection" in core).toBe(false);
    expect(typeof core.createBunSqlPool).toBe("function");
    expect(typeof core.createDatabaseQueryProxy).toBe("function");
    expect(typeof core.rssResponse).toBe("function");
    expect(typeof core.resetMemoryThrottleForTests).toBe("function");
    expect(typeof core.createCacheStore).toBe("function");
    expect(typeof core.configureContentSecurityPolicy).toBe("function");
    expect(typeof core.createWebErrorView).toBe("function");
    expect(typeof core.isProductionEnv).toBe("function");
    expect(typeof core.envFlagEnabled).toBe("function");
    expect(typeof core.appDisplayName).toBe("function");
    expect(typeof core.requireConfiguredSecret).toBe("function");
    expect(typeof core.resetMysqlLoaderForTests).toBe("function");
    expect(typeof core.createMysqlPool).toBe("function");
    expect(typeof core.createMysqlConnectionFromPool).toBe("function");
    expect(typeof core.loginRedirectLocation).toBe("function");
    expect(typeof core.assertSafeOutboundUrl).toBe("function");
    expect(typeof core.webErrorResponse).toBe("function");
    expect(typeof core.renderWebErrorHtml).toBe("function");
    expect(typeof core.createMemoryLoginThrottleMiddleware).toBe("function");
    expect(typeof core.resolveLoginIdentity).toBe("function");
  });
});

test("root API excludes ambient owners while retaining canonical bindings and event utilities", () => {
  for (const name of [
    "afterCommit",
    "hasActiveTransaction",
    "isActiveTransactionConnection",
    "requestTransactionRollback",
    "runInTransaction",
    "eventBus",
    "readSharedEventBus",
    "dispatchModelEvent",
    "runWithDeferredModelEvents",
    "onDeferredModelRollback",
  ])
    expect(name in core).toBe(false);
  expect(typeof core.createDatabaseBindings).toBe("function");
  expect(typeof core.EventBus).toBe("function");
  expect(core.modelEventName("orders", "created")).toBe("orders.created");
});

test("root and Factory subpath definitions bind through either public export", () => {
  const fromRoot = core.defineFactory({
    construct: () => ({ definition: () => ({ name: "root" }) }),
  });
  const fromSubpath = defineFactory({
    construct: () => ({ definition: () => ({ name: "subpath" }) }),
  });
  expect(Factory.from(fromRoot).make()).toEqual({ name: "root" });
  expect(core.Factory.from(fromSubpath).make()).toEqual({ name: "subpath" });
});
