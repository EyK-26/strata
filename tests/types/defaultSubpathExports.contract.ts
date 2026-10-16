import assert from "node:assert/strict";
import { BaseRepository as RootRepository } from "@getstrata/core";
import MembershipService from "@getstrata/core/auth/membershipService";
import CacheRepository from "@getstrata/core/cache/repository";
import SimpleCache from "@getstrata/core/cache/simpleCache";
import SimpleCacheStore from "@getstrata/core/cache/simpleCacheStore";
import Repository, { BaseRepository } from "@getstrata/core/database/baseRepository";
import ExportAuditLogsJob from "@getstrata/core/jobs/exportAuditLogsJob";
import InvalidateCacheTagsJob from "@getstrata/core/jobs/invalidateCacheTagsJob";
import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "@getstrata/core/queue/failedJobService";

// Executed against installed tarballs too; source aliases alone cannot qualify this contract.
for (const value of [
  Repository,
  MembershipService,
  CacheRepository,
  SimpleCache,
  SimpleCacheStore,
  ExportAuditLogsJob,
  InvalidateCacheTagsJob,
  FailedJobRepository,
  FailedJobService,
]) {
  assert.equal(typeof value, "function");
}
const repositoryConstructor: typeof BaseRepository = Repository;
assert.equal(repositoryConstructor, BaseRepository);
assert.equal(repositoryConstructor, RootRepository);
