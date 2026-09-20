import type { StrataCommandMap } from "../types.ts";
import { makeFactoryCommand } from "./makeFactory.ts";
import { makeJobCommand } from "./makeJob.ts";
import { makeListenerCommand } from "./makeListener.ts";
import { makeMigrationCommand } from "./makeMigration.ts";
import { makeModuleCommand } from "./makeModule.ts";
import { makePolicyCommand } from "./makePolicy.ts";
import { makeRequestCommand } from "./makeRequest.ts";
import {
  ensureDirectory,
  migrationDirectory,
  moduleDirectory,
  timestampForFilename,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  webViewsDirectory,
} from "./utils.ts";

const scaffoldCommands: StrataCommandMap = {
  "make:module": async () => makeModuleCommand,
  "make:policy": async () => makePolicyCommand,
  "make:job": async () => makeJobCommand,
  "make:listener": async () => makeListenerCommand,
  "make:request": async () => makeRequestCommand,
  "make:factory": async () => makeFactoryCommand,
  "make:migration": async () => makeMigrationCommand,
};

export {
  ensureDirectory,
  makeFactoryCommand,
  makeJobCommand,
  makeListenerCommand,
  makeMigrationCommand,
  makeModuleCommand,
  makePolicyCommand,
  makeRequestCommand,
  migrationDirectory,
  moduleDirectory,
  scaffoldCommands,
  timestampForFilename,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  webViewsDirectory,
};
