import { describe, expect, test } from "bun:test";
import BaseRepository from "../../src/core/database/baseRepository.ts";
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

  test("exports seeder runner helpers", () => {
    expect(typeof core.runSeedersFromDirectory).toBe("function");
    expect(typeof core.loadSeedersFromDirectory).toBe("function");
  });

  test("exports API resource helpers", () => {
    expect(typeof core.serializeDate).toBe("function");
    expect(typeof core.toResourceCollection).toBe("function");
  });

  test("exports scheduler and graceful shutdown helpers", () => {
    expect(typeof core.runDueScheduledTasks).toBe("function");
    expect(typeof core.installGracefulShutdownSignals).toBe("function");
    expect(typeof core.securedBindRouteModelByKey).toBe("function");
  });
});
