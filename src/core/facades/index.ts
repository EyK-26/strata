import {
  resolveApplicationAuth,
  resolveApplicationCache,
  resolveApplicationConfig,
  resolveApplicationLogger,
  resolveApplicationPolicyGate,
  resolveApplicationQueue,
} from "../../bootstrap/applicationRegistry";
import { eventBus } from "../events";

function cache() {
  return resolveApplicationCache();
}

function auth() {
  return resolveApplicationAuth();
}

function policyGate() {
  return resolveApplicationPolicyGate();
}

function queue() {
  return resolveApplicationQueue();
}

function events() {
  return eventBus;
}

function config<T>(key: string): T | undefined {
  return resolveApplicationConfig().get<T>(key);
}

function log() {
  return resolveApplicationLogger();
}

export { auth, cache, config, events, log, policyGate, queue };
