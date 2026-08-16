import { describe, expect, test } from "bun:test";
import { formatCefLine, formatSiemAuditEvent } from "@getstrata/core/audit/siemFormatter";

describe("siemFormatter", () => {
  test("formats audit events for SIEM ingestion", () => {
    const event = formatSiemAuditEvent({
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

    expect(event.event_type).toBe("workhub.audit");
    expect(formatCefLine(event)).toContain("organization.created");
  });
});
