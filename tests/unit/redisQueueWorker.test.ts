import { JobRegistry } from "@getstrata/core/queue/jobRegistry";

const jobRegistry = new JobRegistry();

import { describe, expect, test } from "bun:test";
import { parseQueueJobEnvelope } from "@getstrata/core/queue/redisQueue";

describe("parseQueueJobEnvelope", () => {
  test("returns null for malformed JSON", () => {
    expect(parseQueueJobEnvelope("{not-json", jobRegistry)).toBeNull();
  });

  test("returns null when job name is missing", () => {
    expect(parseQueueJobEnvelope(JSON.stringify({ payload: {} }), jobRegistry)).toBeNull();
  });

  test("returns null for unknown job names", () => {
    expect(
      parseQueueJobEnvelope(
        JSON.stringify({ name: "missing.job", payload: {}, attempts: 0 }),
        jobRegistry,
      ),
    ).toBeNull();
  });
});
