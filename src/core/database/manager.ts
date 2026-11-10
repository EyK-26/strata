import { PersistenceError } from "@getstrata/core/database/errors";
import type { RawPool } from "./driverPorts";

/** Resource-free immutable assembly over separately application-owned pools. */
class DatabaseManager {
  private readonly pools: ReadonlyMap<string, RawPool>;

  constructor(
    readonly defaultConnection: string,
    connections: readonly (readonly [string, RawPool])[],
  ) {
    const pools = new Map(connections);
    if (!pools.has(defaultConnection)) throw new PersistenceError("DATABASE_CONFIG_INVALID");
    this.pools = pools;
    Object.freeze(this);
  }

  connection(name = this.defaultConnection): RawPool {
    const pool = this.pools.get(name);
    if (!pool) throw new PersistenceError("DATABASE_CONNECTION_UNKNOWN");
    return pool;
  }
}

export { DatabaseManager };
