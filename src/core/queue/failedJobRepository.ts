import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { sqlTimestamp } from "@getstrata/core/database/dialect";
import type { MutationValues, QueryOptions } from "@getstrata/core/database/types";
import { failedJobTable } from "./failedJobTable";
import type { FailedJobRecord } from "./types";

class FailedJobRepository extends BaseRepository<FailedJobRecord, "id"> {
  constructor() {
    super(failedJobTable);
  }

  override async create(values: MutationValues<FailedJobRecord>): Promise<FailedJobRecord> {
    // This table owns the JSON/timestamp storage mapping. Repository callers and
    // replay callbacks retain the logical Record/Date contract on every driver.
    const stored = {
      ...values,
      ...(values.payload === undefined ? {} : { payload: JSON.stringify(values.payload) }),
      ...(values.failed_at === undefined ? {} : { failed_at: sqlTimestamp(values.failed_at) }),
    };
    return hydrateFailure(await super.create(stored as MutationValues<FailedJobRecord>));
  }

  override async findAll(options: QueryOptions<FailedJobRecord> = {}): Promise<FailedJobRecord[]> {
    return (await super.findAll(options)).map(hydrateFailure);
  }
}

function hydrateFailure(row: FailedJobRecord): FailedJobRecord {
  return {
    ...row,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    failed_at: row.failed_at instanceof Date ? row.failed_at : new Date(row.failed_at),
  };
}

export { FailedJobRepository };
export default FailedJobRepository;
