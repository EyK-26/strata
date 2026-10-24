/** Fixture-owned resources and counters; not a startup validator or runtime adapter. */
import type { Server } from "bun";
import type { Mode } from "./types.ts";
export interface Resource {
  server: Server<unknown>;
  port: number;
  label: string;
  closed: number;
}
export interface Attempt {
  mode: Mode;
  number: number;
  events: string[];
  resources: Resource[];
  factoryCalls: number;
  handlers: number;
  getters: number;
  traps: number;
  startupError: Error;
  cleanupError: Error;
  drainError: Error;
}
export const attempts: Attempt[] = [];
export let current: Attempt;
export function begin(mode: Mode): Attempt {
  current = {
    mode,
    number: attempts.length + 1,
    events: [],
    resources: [],
    factoryCalls: 0,
    handlers: 0,
    getters: 0,
    traps: 0,
    startupError: new Error(`owned ${mode} startup`),
    cleanupError: new Error(`owned ${mode} cleanup`),
    drainError: new Error(`owned ${mode} drain`),
  };
  attempts.push(current);
  return current;
}
export function acquire(attempt: Attempt, label: string): Resource {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(`owned-${label}`),
  });
  if (!server.port) throw new Error("Owned resource did not bind.");
  const resource = { server, port: server.port, label, closed: 0 };
  attempt.resources.push(resource);
  attempt.events.push(`${label}.acquire`);
  return resource;
}
