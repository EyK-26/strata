/** Copied into installed type qualification: retired globals cannot be imported. */

import {
  assertRlsLiveDatabaseRole,
  // @ts-expect-error mutable live-role inspector override retired
  setLivePostgresRoleInspectorForTests,
} from "@getstrata/bootstrap/secretsGuard";
import type { createDatabaseQueryProxy } from "@getstrata/core";
import * as core from "@getstrata/core";
// @ts-expect-error retired bound alias subpath
import * as binding from "@getstrata/core/database/bindConnection";
// @ts-expect-error retired bound registry subpath
import * as bound from "@getstrata/core/database/boundConnection";
import {
  // @ts-expect-error global binder retired while explicit constructor remains
  bindBunSql,
  type CreateBunSqlPoolOptions,
  type createBunSqlPool,
} from "@getstrata/core/database/bunSql";
// @ts-expect-error retired registry subpath
import * as defaults from "@getstrata/core/database/defaultConnection";
// @ts-expect-error retired named registry subpath
import * as named from "@getstrata/core/database/namedConnections";
// @ts-expect-error retired implicit repository proxy subpath
import * as repository from "@getstrata/core/database/repositoryConnection";
export function retiredPersistenceTypeSurface(options: CreateBunSqlPoolOptions) {
  const poolConstructor: typeof createBunSqlPool = core.createBunSqlPool;
  const proxy: typeof createDatabaseQueryProxy = core.createDatabaseQueryProxy;
  // @ts-expect-error no global default getter
  core.getDefaultDatabasePool;
  // @ts-expect-error no global default query
  core.getDefaultDatabaseQuery;
  // @ts-expect-error no global default registration
  core.registerDefaultDatabasePool;
  // @ts-expect-error no global default identity
  core.isDefaultDatabaseConnection;
  // @ts-expect-error no global default reset
  core.resetDefaultDatabasePoolForTests;
  // @ts-expect-error no bound connection global
  core.bindDatabaseConnection;
  // @ts-expect-error no bound connection lookup
  core.getBoundDatabaseConnection;
  // @ts-expect-error no bound connection reset
  core.resetBoundDatabaseConnection;
  // @ts-expect-error no global binder
  core.bindBunSql;
  // @ts-expect-error no named global registry
  core.registerNamedConnection;
  // @ts-expect-error no named ambient runner
  core.runOnNamedConnection;
  // @ts-expect-error no implicit repository lookup
  core.resolveRepositoryConnection;
  // @ts-expect-error no implicit repository proxy
  core.repositoryConnection;
  // @ts-expect-error explicit environment and selected inspector are required
  assertRlsLiveDatabaseRole();
  // @ts-expect-error applicable caller cannot omit inspector in typed code
  assertRlsLiveDatabaseRole({ TENANCY_DRIVER: "rls" });
  void [
    poolConstructor,
    proxy,
    options,
    bindBunSql,
    defaults,
    binding,
    bound,
    named,
    repository,
    setLivePostgresRoleInspectorForTests,
  ];
}
