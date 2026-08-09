export type { EventListener } from "./eventBus";
export { EventBus, eventBus, readSharedEventBus } from "./eventBus";

function modelEventName(tableName: string, action: string): string {
  return `${tableName}.${action}`;
}

export { modelEventName };
