import { createAsyncContextStore } from "../runtime/asyncContextStore";
import { currentTenant, type TenantContext } from "../tenant/tenantContext";
import { eventBus } from "./eventBus";

type DeferredModelEvent = {
  event: string;
  payload: unknown;
  tenant: TenantContext | null;
};

type DeferredModelEventState = {
  frames: DeferredModelEvent[][];
};

const deferredModelEvents = createAsyncContextStore<DeferredModelEventState>(
  "@getstrata/deferredModelEvents",
);

function sameTenant(left: TenantContext | null, right: TenantContext | null): boolean {
  if (left === null && right === null) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return left.id === right.id;
}

function groupQueuedModelEvents(queued: DeferredModelEvent[]): DeferredModelEvent[][] {
  const groups: DeferredModelEvent[][] = [];

  for (const item of queued) {
    const lastGroup = groups[groups.length - 1];
    const last = lastGroup?.[lastGroup.length - 1];
    if (!lastGroup || !last || !sameTenant(last.tenant, item.tenant)) {
      groups.push([item]);
    } else {
      lastGroup.push(item);
    }
  }

  return groups;
}

async function dispatchEventBatch(batch: DeferredModelEvent[]): Promise<void> {
  for (const item of batch) {
    await eventBus.dispatch(item.event, item.payload);
  }
}

async function dispatchQueuedModelEvents(queued: DeferredModelEvent[]): Promise<void> {
  if (queued.length === 0) {
    return;
  }

  const { runWithTenantDatabase } = await import("../tenant/tenantDatabaseScope.ts");

  for (const batch of groupQueuedModelEvents(queued)) {
    const tenant = batch[0]?.tenant ?? null;
    if (tenant) {
      await runWithTenantDatabase(tenant, () => dispatchEventBatch(batch));
    } else {
      await dispatchEventBatch(batch);
    }
  }
}

async function dispatchModelEvent(event: string, payload: unknown): Promise<void> {
  const state = deferredModelEvents.getStore();
  const frame = state?.frames[state.frames.length - 1];

  if (frame) {
    frame.push({
      event,
      payload,
      tenant: currentTenant(),
    });
    return;
  }

  await eventBus.dispatch(event, payload);
}

async function runWithDeferredModelEvents<T>(callback: () => T | Promise<T>): Promise<T> {
  const existing = deferredModelEvents.getStore();

  if (existing) {
    existing.frames.push([]);
    try {
      const result = await callback();
      const nested = existing.frames.pop() ?? [];
      const parent = existing.frames[existing.frames.length - 1];
      if (parent) {
        parent.push(...nested);
      }
      return result;
    } catch (error) {
      existing.frames.pop();
      throw error;
    }
  }

  const state: DeferredModelEventState = { frames: [[]] };
  const result = await deferredModelEvents.run(state, callback);
  await dispatchQueuedModelEvents(state.frames[0] ?? []);
  return result;
}

export { dispatchModelEvent, runWithDeferredModelEvents };
