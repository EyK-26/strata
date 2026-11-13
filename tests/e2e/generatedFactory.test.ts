import { test } from "bun:test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../helpers/generatedSecurityApp.ts";
import { GeneratedSecurityAppOwner } from "../helpers/generatedSecurityAppOwner.ts";
import { STARTUP_PROBE_OPTIONS } from "../helpers/startupProbe.ts";

test("shipped Factory scaffold preserves selected SQLite scopes through public package exports", async () => {
  const fixture = await createGeneratedSecurityApp("sqlite", STARTUP_PROBE_OPTIONS);
  // Reuse the fixture owner's joined child/stream/termination protocol without
  // giving this child-only owner authority to delete the generated app root.
  const identity = crypto.randomUUID().replaceAll("-", "");
  const children = new GeneratedSecurityAppOwner(
    `generated_security_${identity}`,
    `q01_${identity.slice(0, 18)}`,
  );
  const errors: unknown[] = [];
  try {
    const module = join(fixture.app, "src/modules/widget");
    await mkdir(module, { recursive: true });
    await writeFile(
      join(module, "types.ts"),
      "export interface WidgetRecord { id: number; name: string; parent_id: number | null }\n",
    );
    await children.runChild(
      [
        process.execPath,
        join(fixture.app, "node_modules/@getstrata/cli/cli.ts"),
        "make:factory",
        "widget",
      ],
      fixture.app,
      45_000,
    );
    const target = join(fixture.app, "src/qualification");
    await mkdir(target);
    await copyFile(
      join(import.meta.dir, "../fixtures/generatedFactoryConsumer.ts.txt"),
      join(target, "consumer.ts"),
    );
    await children.runChild([process.execPath, "run", "check"], fixture.app, 45_000);
    await children.runChild([process.execPath, join(target, "consumer.ts")], fixture.app, 45_000);
  } catch (error) {
    errors.push(error);
  } finally {
    let childrenConfirmed = true;
    try {
      await children.close();
    } catch (error) {
      childrenConfirmed = false;
      errors.push(error);
    }
    if (childrenConfirmed) {
      try {
        await fixture.close();
      } catch (error) {
        errors.push(error);
      }
    } else
      console.error(
        "Generated Factory child termination unconfirmed; retained fixture",
        fixture.app,
      );
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Generated Factory test and cleanup failed");
}, 180_000);
