export { EventBus, eventBus } from "./eventBus";
export type { EventListener } from "./eventBus";

function modelEventName(tableName: string, action: string): string {
  return `${tableName}.${action}`;
}

export { modelEventName };
