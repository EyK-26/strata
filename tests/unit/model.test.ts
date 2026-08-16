import { describe, expect, test } from "bun:test";
import { NotFoundError } from "@getstrata/core/errors/http";
import BaseRepository from "../../src/core/database/baseRepository";
import { Model, registerModelRepository } from "../../src/core/database/model";
import { belongsTo, hasMany } from "../../src/core/database/relationships";
import { defineTable } from "../../src/core/database/table";

interface Widget {
  id: number;
  name: string;
}

interface WidgetTag {
  id: number;
  widget_id: number;
  label: string;
}

const widgetTable = defineTable<Widget, "id">({
  name: "widgets",
  primaryKey: "id",
  columns: ["id", "name"],
});

const tagTable = defineTable<WidgetTag, "id">({
  name: "widget_tags",
  primaryKey: "id",
  columns: ["id", "widget_id", "label"],
});

const widgetConnection = {
  async unsafe<T>(query: string, params: readonly unknown[] = []) {
    if (query.includes("WHERE") && query.includes(`"widgets"."id"`)) {
      const id = Number(params[0]);
      if (id === 1) return [{ id: 1, name: "Alpha" }] as T[];
      return [] as T[];
    }

    if (query.includes("ORDER BY")) {
      return [
        { id: 1, name: "Alpha" },
        { id: 2, name: "Beta" },
      ] as T[];
    }

    throw new Error(`Unexpected query: ${query}`);
  },
};

class WidgetRepository extends BaseRepository<Widget, "id"> {
  constructor() {
    super(widgetTable, widgetConnection);
  }
}

class WidgetTagRepository extends BaseRepository<WidgetTag, "id"> {
  constructor() {
    super(tagTable, widgetConnection);
  }
}

const widgetRepository = new WidgetRepository();

class WidgetModelBase extends Model<Widget, "id"> {
  protected override primaryKey(): "id" {
    return "id";
  }
}

class UnregisteredWidgetModel extends Model<Widget, "id"> {
  protected override primaryKey(): "id" {
    return "id";
  }
}

const WidgetModel = registerModelRepository(
  WidgetModelBase,
  widgetRepository,
) as typeof WidgetModelBase;

const widgetHasTags = hasMany<Widget, WidgetTag, "id", "widget_id">({
  name: "tags",
  localKey: "id",
  foreignKey: "widget_id",
});

const widgetBelongsToTag = belongsTo<WidgetTag, Widget, "widget_id", "id">({
  name: "widget",
  foreignKey: "widget_id",
  ownerKey: "id",
});

describe("Model", () => {
  test("find returns a model instance when a record exists", async () => {
    const widget = (await WidgetModel.find(1)) as WidgetModelBase | null;
    expect(widget?.get("name")).toBe("Alpha");
    expect(widget?.id).toBe(1);
  });

  test("findOrFail throws NotFoundError when a record is missing", async () => {
    await expect(WidgetModel.findOrFail(99)).rejects.toThrow(NotFoundError);
  });

  test("all maps repository rows to model instances", async () => {
    const widgets = await WidgetModel.all({ orderBy: { name: "asc" } });
    expect(widgets).toHaveLength(2);
    expect(widgets[0]?.toObject()).toEqual({ id: 1, name: "Alpha" });
  });

  test("firstWhere returns the first matching model", async () => {
    const widget = await WidgetModel.firstWhere({ id: 1 });
    expect(widget?.id).toBe(1);
  });

  test("repository and query delegate to the registered repository", () => {
    expect(WidgetModel.repository()).toBe(widgetRepository as never);
    expect(typeof WidgetModel.query().get).toBe("function");
  });

  test("throws when repository is not registered", async () => {
    expect(() => UnregisteredWidgetModel.repository()).toThrow(
      "UnregisteredWidgetModel.repository() is not implemented.",
    );
    await expect(UnregisteredWidgetModel.find(1)).rejects.toThrow(
      "UnregisteredWidgetModel.repository() is not implemented.",
    );
  });

  test("mergeAttributes updates the underlying record", async () => {
    const widget = (await WidgetModel.find(1)) as WidgetModelBase | null;
    if (!widget) throw new Error("expected widget");
    widget.mergeAttributes({ name: "Renamed" });
    expect(widget.toObject().name).toBe("Renamed");
  });

  test("loadHasMany attaches related records", async () => {
    const widget = (await WidgetModel.find(1)) as WidgetModelBase | null;
    if (!widget) throw new Error("expected widget");

    const childRepository = {
      withConnection: () => ({
        loadHasManyForParents: async () =>
          new Map([[1, [{ id: 10, widget_id: 1, label: "sale" }]]]),
      }),
    } as unknown as BaseRepository<WidgetTag, "id">;

    const loaded = await widget.loadHasMany("tags", widgetHasTags, childRepository as never);
    expect(loaded.tags).toEqual([{ id: 10, widget_id: 1, label: "sale" }]);
  });

  test("loadBelongsTo attaches the parent record", async () => {
    widgetRepository.loadBelongsToForParents = async () =>
      new Map([[1, { id: 1, name: "Alpha" }]]) as never;

    const tagRecord = { id: 10, widget_id: 1, label: "sale" };
    const tagModel = new (class extends Model<WidgetTag, "id"> {
      protected override primaryKey(): "id" {
        return "id";
      }
    })(tagRecord, new WidgetTagRepository());

    const loaded = await tagModel.loadBelongsTo("widget", widgetBelongsToTag, widgetRepository);
    expect(loaded.widget).toEqual({ id: 1, name: "Alpha" });
  });

  test("default primaryKey throws for misconfigured models", () => {
    class MisconfiguredModel extends Model<Widget, "id"> {}
    const model = new MisconfiguredModel({ id: 1, name: "Broken" }, widgetRepository);
    expect(() => model.toObject()).not.toThrow();
    expect(() => model.id).toThrow("MisconfiguredModel.primaryKey() is not implemented.");
  });
});
