import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { copyApplicationConfig } from "../config/configSnapshot";
import type { ApplicationConfig, ExecutionActor } from "../contracts/application";
import { normalizeExecutionEnvelope } from "../runtime/executionContext";
import type { Job, Queue } from "./index";
import type { JobRegistry } from "./jobRegistry";
import type { QueueJobEnvelope } from "./jobRunner";

interface QueueIdentity {
  readonly actor: ExecutionActor;
  readonly tenant?: ApplicationConfig;
}
interface QueueHandoff {
  /** Privileged composition capability: callers must already trust the supplied identity. */
  seal(name: string, payload: object, identity: QueueIdentity): string;
  /** Verify before entering application.invoke or constructing a job. */
  verify(job: QueueJobEnvelope): QueueIdentity;
}
class QueueHandoffError extends TypeError {
  readonly code = "QUEUE_HANDOFF_INVALID";
  constructor() {
    super("Queue handoff is invalid for this job/application.");
  }
}
const MAX_HANDOFF_BYTES = 32768;
function payloadHash(payload: object): string {
  return createHash("sha256")
    .update(
      JSON.stringify(copyApplicationConfig(payload), (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]]),
            )
          : value,
      ),
    )
    .digest("hex");
}
function snapshotIdentity(identity: QueueIdentity): QueueIdentity {
  const data = copyApplicationConfig(identity);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some((field) => field !== "actor" && field !== "tenant")
  )
    throw new TypeError("Queue identity must contain only actor and tenant data.");
  const envelope = normalizeExecutionEnvelope({ kind: "job", ...data });
  if (envelope.kind !== "job") throw new TypeError("Job identity is required.");
  return Object.freeze({
    actor: envelope.actor,
    ...(envelope.tenant ? { tenant: envelope.tenant } : {}),
  });
}
/**
 * Keys and audience are supplied by application assembly, never read from job data or ambient state.
 * A handoff is an authenticated identity snapshot, replayable for at-least-once retry/recovery.
 * It does not provide revocation freshness or a single-delivery guarantee. Rotate keys to invalidate it.
 */
function createQueueHandoff(options: {
  readonly key: Uint8Array;
  readonly audience: string;
}): QueueHandoff {
  if (!(options.key instanceof Uint8Array) || options.key.byteLength < 32)
    throw new TypeError("Queue handoff requires at least 32 key bytes.");
  if (
    typeof options.audience !== "string" ||
    !options.audience.trim() ||
    options.audience.length > 256
  )
    throw new TypeError("Queue handoff requires a bounded application audience.");
  const key = Buffer.from(options.key);
  const audience = options.audience;
  const sign = (body: string) => createHmac("sha256", key).update(body).digest();
  return Object.freeze<QueueHandoff>({
    seal(name, payload, identity) {
      if (typeof name !== "string" || !name || name.length > 256)
        throw new TypeError("Invalid handoff job name.");
      const body = Buffer.from(
        JSON.stringify({
          version: 1,
          audience,
          name,
          payloadHash: payloadHash(payload),
          identity: snapshotIdentity(identity),
        }),
      ).toString("base64url");
      const token = `${body}.${sign(body).toString("base64url")}`;
      if (token.length > MAX_HANDOFF_BYTES) throw new TypeError("Queue handoff is too large.");
      return token;
    },
    verify(job) {
      try {
        const token = job.handoff;
        if (typeof token !== "string" || token.length > MAX_HANDOFF_BYTES)
          throw new TypeError("Invalid queue handoff.");
        const pieces = token.split(".");
        if (pieces.length !== 2 || !pieces.every((piece) => /^[A-Za-z0-9_-]+$/.test(piece)))
          throw new TypeError("Malformed queue handoff.");
        const body = pieces[0] as string;
        const signature = Buffer.from(pieces[1] as string, "base64url");
        const expected = sign(body);
        if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
          throw new TypeError("Untrusted queue handoff.");
        const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (
          !decoded ||
          typeof decoded !== "object" ||
          Array.isArray(decoded) ||
          Object.keys(decoded).sort().join(",") !== "audience,identity,name,payloadHash,version" ||
          decoded.version !== 1 ||
          decoded.audience !== audience ||
          decoded.name !== job.name ||
          decoded.payloadHash !== payloadHash(job.payload)
        )
          throw new TypeError("Queue handoff does not match this job/application.");
        return snapshotIdentity(decoded.identity);
      } catch {
        throw new QueueHandoffError();
      }
    },
  });
}
/** Capture identity data only; no request scope, signal, database session or resolver survives dispatch. */
function createIdentityQueue(
  queue: Queue,
  registry: JobRegistry,
  handoff: QueueHandoff,
  identity: QueueIdentity,
): Pick<Queue, "dispatch"> {
  const captured = snapshotIdentity(identity);
  return Object.freeze({
    async dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void> {
      const name = registry.resolveName(job);
      if (!name) throw new Error("Job is not registered with the queue worker registry.");
      const snapshot = copyApplicationConfig(payload) as TPayload;
      await queue.dispatch(job, snapshot, { handoff: handoff.seal(name, snapshot, captured) });
    },
  });
}

export type { QueueHandoff, QueueIdentity };
export { createIdentityQueue, createQueueHandoff, QueueHandoffError };
