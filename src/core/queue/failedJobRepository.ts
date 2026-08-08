import { BaseRepository } from "../database";
import { failedJobTable } from "./failedJobTable";
import type { FailedJobRecord } from "./types";

class FailedJobRepository extends BaseRepository<FailedJobRecord, "id"> {
  constructor() {
    super(failedJobTable);
  }
}

export default FailedJobRepository;
