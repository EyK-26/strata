import { expect, test } from "bun:test";
import { makeModelCommand, makeViewCommand } from "@getstrata/cli/scaffold";
import { commands } from "../../../src/cli/register";

test("framework CLI selects the same public model and view commands as generated apps", async () => {
  const model = commands["make:model"],
    view = commands["make:view"];
  expect(model).toBeDefined();
  expect(view).toBeDefined();
  if (!model || !view) throw new Error("Missing native scaffold registration");
  expect(await model()).toBe(makeModelCommand);
  expect(await view()).toBe(makeViewCommand);
});
