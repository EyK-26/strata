import { expect, test } from "bun:test";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import {
  CORE_EVENT_BUS_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_POLICY_REGISTRY_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { Job } from "@getstrata/core/queue";

// These consumer tokens accept structural adapters, with no lifecycle or
// registration stubs. Compile-time assertions remain inside an uncalled body.
function assertConsumerSurface(container: ServiceContainer) {
  // @ts-expect-error Event publishers do not own listener registration.
  container.resolve(CORE_EVENT_BUS_TOKEN).listen("example", () => {});
  // @ts-expect-error Dispatch consumers do not own queue shutdown.
  container.resolve(CORE_QUEUE_TOKEN).close();
  // @ts-expect-error Dispatch consumers do not own failed-job replay.
  container.resolve(CORE_QUEUE_TOKEN).replay(new ExampleJob(), {}, "id");
  // @ts-expect-error Policy consumers do not own policy registration.
  container.resolve(CORE_POLICY_GATE_TOKEN).register("example", new Policy());
}
void assertConsumerSurface;

class ExampleJob extends Job {
  async handle(): Promise<void> {}
}

test("consumer tokens accept dispatch-only event and queue adapters", async () => {
  const container = new ServiceContainer();
  const events: string[] = [];
  const jobs: Job[] = [];
  container.set(CORE_EVENT_BUS_TOKEN, {
    async dispatch(event) {
      events.push(event);
    },
  });
  container.set(CORE_QUEUE_TOKEN, {
    async dispatch(job) {
      jobs.push(job);
    },
  });
  container.set(CORE_POLICY_GATE_TOKEN, {
    async allows() {
      return true;
    },
    async authorize() {},
  });
  const job = new ExampleJob();
  await container.resolve(CORE_EVENT_BUS_TOKEN).dispatch("example", {});
  await container.resolve(CORE_QUEUE_TOKEN).dispatch(job, {});
  expect(await container.resolve(CORE_POLICY_GATE_TOKEN).allows("example", "view", undefined)).toBe(
    true,
  );
  expect(events).toEqual(["example"]);
  expect(jobs).toEqual([job]);
});

test("policy registration and decisions can share one explicitly owned gate", async () => {
  const container = new ServiceContainer();
  const gate = new PolicyGate();
  container.set(CORE_POLICY_GATE_TOKEN, gate);
  container.set(CORE_POLICY_REGISTRY_TOKEN, gate);
  class Visible extends Policy {
    override view() {
      return true;
    }
  }
  container.resolve(CORE_POLICY_REGISTRY_TOKEN).register("example", new Visible());
  expect(await container.resolve(CORE_POLICY_GATE_TOKEN).allows("example", "view", undefined)).toBe(
    true,
  );
  expect(container.resolve(CORE_POLICY_GATE_TOKEN) as unknown).toBe(
    container.resolve(CORE_POLICY_REGISTRY_TOKEN),
  );
});
