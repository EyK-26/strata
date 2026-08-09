export type { EventListener } from "./eventBus";
export { EventBus, eventBus } from "./eventBus";

function modelEventName(tableName: string, action: string): string {
  return `${tableName}.${action}`;
}

export { modelEventName };
