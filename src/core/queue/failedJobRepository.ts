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
    const rows = await super.findAll(options);
    // Selections are driver projections. An alias named payload/failed_at need
    // not represent stored JSON/a timestamp and must not be coerced as one.
    return options.select?.length ? rows : rows.map(hydrateFailure);
  }
}

function hydrateFailure(row: FailedJobRecord): FailedJobRecord {
  const result = { ...row };
  if (typeof row.payload === "string") result.payload = JSON.parse(row.payload);
  // A projection must retain exactly its selected fields; absent timestamps
  // must not become fabricated Invalid Dates (or extra JSON null properties).
  if ("failed_at" in row && !(row.failed_at instanceof Date)) {
    result.failed_at = new Date(row.failed_at);
  }
  return result;
}

export { FailedJobRepository };
export default FailedJobRepository;
