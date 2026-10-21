/** Installed consumer of public Model registration and observer behavior. */
import assert from "node:assert/strict";
import { bootModels, defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; label: string };
const table = defineTable<Row, "id">({
  name: "qualification_registry",
  primaryKey: "id",
  columns: ["id", "label"],
});
const hooks: string[] = [];
class First extends defineModel(table) {
  static override $morphClass = "qualification-shared";
  static override boot() {
    hooks.push("first-boot");
  }
}
class Second extends defineModel(table) {
  static override $morphClass = "qualification-shared";
  static override boot() {
    hooks.push("second-boot");
  }
}
assert.throws(() => bootModels([First, Second]), /Duplicate model name/);
assert.deepEqual(hooks.slice(), []);
bootModels([First, First]);
assert.deepEqual(hooks, ["first-boot"]);
class Child extends First {
  static override $morphClass = "qualification-child";
}
assert.notEqual(First.repository<Row, "id">(), Child.repository<Row, "id">());
assert.equal(Child.repository<Row, "id">(), Child.repository<Row, "id">());

let attempts = 0;
class Retried extends defineModel(table) {
  static override $fillable = ["id", "label"];
  static override $timestamps = false;
  static override boot() {
    const attempt = ++attempts;
    Retried.observe({ saving: () => hooks.push(`attempt-${attempt}`) });
    if (attempt === 1) throw new Error("qualification boot failure");
  }
}
Retried.observe({ saving: () => hooks.push("before-boot") });
assert.throws(() => bootModels([Retried]), /qualification boot failure/);
bootModels([Retried]);
Retried.observe({
  saving: async () => {
    await Promise.resolve();
    hooks.push("cancel");
    return false;
  },
});
Retried.observe({ saving: () => hooks.push("after-cancellation") });
hooks.length = 0;
await assert.rejects(
  Retried.create({ id: 1, label: "never-persisted" }),
  /create\(\) was cancelled by an observer/,
);
assert.deepEqual(hooks, ["before-boot", "attempt-2", "cancel"]);
assert.equal(attempts, 2);
console.log("PASS installed Model registration, retry, concrete identity and observer admission");
