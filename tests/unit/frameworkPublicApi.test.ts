import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
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

  test("exports Model helpers for Eloquent-parity ORM", () => {
    expect(typeof core.Model).toBe("function");
    expect(typeof core.registerModelRepository).toBe("function");
    expect(typeof core.hydrateValue).toBe("function");
    expect(typeof core.filterMassAssignable).toBe("function");
    expect(typeof core.HasManyRelationQuery).toBe("function");
    expect(typeof core.HasOneRelationQuery).toBe("function");
    expect(typeof core.BelongsToRelationQuery).toBe("function");
    expect(typeof core.BelongsToManyRelationQuery).toBe("function");
    expect(typeof core.Factory).toBe("function");
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
  });

  test("exports membership lookup used by published bootstrap", () => {
    expect(typeof core.resolveMembershipLookup).toBe("function");
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
    expect(typeof core.registerDefaultDatabasePool).toBe("function");
    expect(typeof core.getBoundDatabaseConnection).toBe("function");
    expect(typeof core.resetBoundDatabaseConnection).toBe("function");
    expect(typeof core.bindBunSql).toBe("function");
    expect(typeof core.createBunSqlPool).toBe("function");
    expect(typeof core.rssResponse).toBe("function");
    expect(typeof core.resetMemoryThrottleForTests).toBe("function");
    expect(typeof core.createCacheStore).toBe("function");
    expect(typeof core.configureContentSecurityPolicy).toBe("function");
    expect(typeof core.configureWebErrorView).toBe("function");
    expect(typeof core.loginRedirectLocation).toBe("function");
  });
});
