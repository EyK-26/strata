export type { EventDispatcher, EventListener } from "./eventBusClass";
export { EventBus } from "./eventBusClass";

function modelEventName(tableName: string, action: string): string {
  return `${tableName}.${action}`;
}

export { modelEventName };
