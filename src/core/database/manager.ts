import { PersistenceError } from "@getstrata/core/database/errors";
import type { DatabaseOwnership } from "#strata-orm-internal";
import type { RawPool } from "./driverPorts";

/** Resource-free immutable assembly over separately application-owned pools. */
class DatabaseManager {
  private readonly pools: ReadonlyMap<string, RawPool>;

  constructor(
    readonly defaultConnection: string,
    connections: readonly (readonly [string, RawPool])[],
    private readonly ownership: DatabaseOwnership,
  ) {
    const pools = new Map(connections);
    if (!pools.has(defaultConnection)) throw new PersistenceError("DATABASE_CONFIG_INVALID");
    if (new Set(pools.values()).size !== pools.size)
      throw new PersistenceError("DATABASE_CONFIG_INVALID");
    this.pools = pools;
    Object.freeze(this);
  }

  configuredPool(pool: RawPool): object {
    for (const [name, configured] of this.pools)
      if (configured === pool) {
        const identity = this.ownership.connections[name];
        if (identity) return identity;
      }
    throw new PersistenceError("DATABASE_CONFIG_INVALID");
  }
  connection(name = this.defaultConnection): RawPool {
    const pool = this.pools.get(name);
    if (!pool) throw new PersistenceError("DATABASE_CONNECTION_UNKNOWN");
    return pool;
  }
}

export { DatabaseManager };
