import { randomBytes } from "node:crypto";

interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: { stringValue: string } }>;
  status: { code: number };
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function createSpan(input: {
  traceId: string;
  name: string;
  startedAt: number;
  endedAt: number;
  attributes?: Record<string, string>;
}): OtelSpan {
  const spanId = randomHex(8);

  return {
    traceId: input.traceId,
    spanId,
    name: input.name,
    startTimeUnixNano: String(Math.floor(input.startedAt * 1_000_000)),
    endTimeUnixNano: String(Math.floor(input.endedAt * 1_000_000)),
    attributes: Object.entries(input.attributes ?? {}).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    })),
    status: { code: 1 },
  };
}

async function exportOtelSpan(span: OtelSpan): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  if (!endpoint) {
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() ?? "workhub-api";
  const url = endpoint.endsWith("/v1/traces")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/v1/traces`;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
          },
          scopeSpans: [{ spans: [span] }],
        },
      ],
    }),
  });
}

export { createSpan, exportOtelSpan };
export type { OtelSpan };
