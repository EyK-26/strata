import { describe, expect, test } from "bun:test";
import { formatCefLine, formatSiemAuditEvent } from "@getstrata/core/audit/siemFormatter";
import { restoreEnvVar } from "../helpers/restoreEnv";

function sampleEvent() {
  return formatSiemAuditEvent({
    action: "organization.created",
    subject_type: "organization",
    subject_id: 1,
    user_id: 1,
    tenant_id: 1,
    trace_id: "abc123",
    ip_address: "127.0.0.1",
    user_agent: "curl",
    checksum: "deadbeef",
    payload: { slug: "acme" },
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("siemFormatter", () => {
  test("formats audit events for SIEM ingestion", () => {
    const previousType = process.env.SIEM_EVENT_TYPE;
    const previousName = process.env.APP_NAME;
    const previousPrefix = process.env.APP_KEY_PREFIX;
    delete process.env.SIEM_EVENT_TYPE;
    delete process.env.APP_NAME;
    delete process.env.APP_KEY_PREFIX;

    try {
      const event = sampleEvent();

      expect(event.event_type).toBe("workhub.audit");
      expect(formatCefLine(event)).toContain("organization.created");
      expect(formatCefLine(event)).toContain("CEF:0|WorkHub|API|1.0|");
    } finally {
      restoreEnvVar("SIEM_EVENT_TYPE", previousType);
      restoreEnvVar("APP_NAME", previousName);
      restoreEnvVar("APP_KEY_PREFIX", previousPrefix);
    }
  });

  test("honors SIEM_EVENT_TYPE and APP_NAME overrides", () => {
    const previousType = process.env.SIEM_EVENT_TYPE;
    const previousName = process.env.APP_NAME;
    process.env.SIEM_EVENT_TYPE = "forum.audit";
    process.env.APP_NAME = "Forum";

    try {
      const event = sampleEvent();

      expect(event.event_type).toBe("forum.audit");
      expect(formatCefLine(event)).toContain("CEF:0|Forum|API|1.0|");
    } finally {
      restoreEnvVar("SIEM_EVENT_TYPE", previousType);
      restoreEnvVar("APP_NAME", previousName);
    }
  });
});
