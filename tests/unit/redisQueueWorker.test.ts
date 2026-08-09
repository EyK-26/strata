import { describe, expect, test } from "bun:test";
import { parseQueueJobEnvelope } from "@getstrata/core/queue/redisQueue";

describe("parseQueueJobEnvelope", () => {
  test("returns null for malformed JSON", () => {
    expect(parseQueueJobEnvelope("{not-json")).toBeNull();
  });

  test("returns null when job name is missing", () => {
    expect(parseQueueJobEnvelope(JSON.stringify({ payload: {} }))).toBeNull();
  });

  test("returns null for unknown job names", () => {
    expect(
      parseQueueJobEnvelope(JSON.stringify({ name: "missing.job", payload: {}, attempts: 0 })),
    ).toBeNull();
  });
});
