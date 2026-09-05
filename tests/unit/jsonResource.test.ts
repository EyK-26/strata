import { describe, expect, test } from "bun:test";
import { JsonResource, whenLoaded } from "@getstrata/core/http/resources";

describe("JsonResource", () => {
  test("wraps toArray output and supports when/whenLoaded/additional", () => {
    const model = {
      name: "Ada",
      loaded(name: string) {
        return name === "role" ? { name: "admin" } : undefined;
      },
      toArray() {
        return { name: "Ada" };
      },
    };

    const resource = JsonResource.make(model).additional({ meta: { ok: true } });

    expect(resource.when(true, "yes")).toBe("yes");
    expect(resource.when(false, "no")).toBeUndefined();
    expect(resource.whenLoaded<{ name: string }>("role")).toEqual({ name: "admin" });
    expect(resource.whenLoaded("missing")).toBeUndefined();
    expect(resource.toResponse()).toEqual({
      data: { name: "Ada" },
      meta: { ok: true },
    });
    expect(whenLoaded(model, "role", (value) => (value as { name: string }).name)).toBe("admin");
  });

  test("whenLoaded returns null for a loaded empty relation without calling transform", () => {
    const model = {
      loaded(name: string) {
        return name === "position" ? null : undefined;
      },
    };
    const resource = JsonResource.make(model);
    let called = false;

    expect(
      resource.whenLoaded("position", () => {
        called = true;
        return { id: 1 };
      }),
    ).toBeNull();
    expect(called).toBe(false);
    expect(resource.whenLoaded("missing", () => ({ id: 1 }))).toBeUndefined();
    expect(whenLoaded(model, "position", () => ({ id: 1 }))).toBeNull();
    expect(JsonResource.make(null).whenLoaded("position")).toBeUndefined();
  });

  test("collection and unwrap", () => {
    JsonResource.wrap = null;
    const bare = new JsonResource({ id: 1 });
    expect(bare.toResponse()).toEqual({ id: 1 });
    JsonResource.wrap = "data";

    const collection = JsonResource.collection([{ id: 1 }, { id: 2 }]);
    expect(collection.toArray()).toEqual({
      data: [{ id: 1 }, { id: 2 }],
    });
    expect(collection.toResponse()).toEqual({
      data: [{ id: 1 }, { id: 2 }],
    });
  });
});
