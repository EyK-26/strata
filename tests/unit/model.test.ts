import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { belongsTo, hasMany } from "@getstrata/core/database/relationships";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { NotFoundError } from "@getstrata/core/errors/http";
import { withBoundDatabase } from "../helpers/boundRepositoryHarness";

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
    if (query.includes('"widget_tags"')) return [{ id: 10, widget_id: 1, label: "sale" }] as T[];
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

class WidgetModelBase extends Model<Widget, "id"> {
  label(): string {
    return this.get("name").toUpperCase();
  }
}
class WidgetTagModel extends Model<WidgetTag, "id"> {}
class TinyModel extends Model<Widget, "id"> {}
const widgetDefinition = defineRepository({
  name: "widgets",
  table: widgetTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const tagDefinition = defineRepository({
  name: "tags",
  table: tagTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const WidgetDefinition = defineModel({
  name: "Widget",
  repository: widgetDefinition,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new WidgetModelBase(state, binding),
});
const TagDefinition = defineModel({
  name: "Tag",
  repository: tagDefinition,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new WidgetTagModel(state, binding),
});
const TinyDefinition = defineModel({
  name: "Tiny",
  repository: widgetDefinition,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new TinyModel(state, binding),
});
const MissingDefinition = defineModel({
  name: "Missing",
  repository: widgetDefinition,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new WidgetModelBase(state, binding),
});
async function withModels(
  work: (context: {
    WidgetModel: BoundModel<Widget, "id", WidgetModelBase>;
    TagModel: BoundModel<WidgetTag, "id", WidgetTagModel>;
    Tiny: BoundModel<Widget, "id", TinyModel>;
    widgetRepository: BaseRepository<Widget, "id">;
    tagRepository: BaseRepository<WidgetTag, "id">;
    db: DatabaseSession;
  }) => Promise<void>,
) {
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [widgetDefinition, tagDefinition],
        models: [WidgetDefinition, TagDefinition, TinyDefinition],
      },
      connection: widgetConnection,
    },
    async (db) =>
      work({
        WidgetModel: db.model(WidgetDefinition),
        TagModel: db.model(TagDefinition),
        Tiny: db.model(TinyDefinition),
        widgetRepository: db.repository(widgetDefinition),
        tagRepository: db.repository(tagDefinition),
        db,
      }),
  );
}

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
    await withModels(async ({ WidgetModel }) => {
      const widget = await WidgetModel.find(1);
      expect(widget?.get("name")).toBe("Alpha");
      expect(widget?.id).toBe(1);
      expect(widget?.label()).toBe("ALPHA");
      expect(widget).toBeInstanceOf(WidgetModelBase);
    });
  });

  test("findOrFail throws NotFoundError when a record is missing", async () => {
    await expect(
      withModels(async ({ WidgetModel }) => {
        await WidgetModel.findOrFail(99);
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test("all maps repository rows to model instances", async () => {
    await withModels(async ({ WidgetModel }) => {
      const widgets = await WidgetModel.all({ orderBy: { name: "asc" } });
      expect(widgets).toHaveLength(2);
      expect(widgets[0]?.toObject()).toEqual({ id: 1, name: "Alpha" });
    });
  });

  test("firstWhere returns the first matching model", async () => {
    await withModels(async ({ WidgetModel }) => {
      const widget = await WidgetModel.firstWhere({ id: 1 });
      expect(widget?.id).toBe(1);
    });
  });

  test("repository and query delegate to the registered repository", async () => {
    await withModels(async ({ WidgetModel, widgetRepository }) => {
      expect(WidgetModel.repository()).toBe(widgetRepository as never);
      expect(typeof WidgetModel.query().get).toBe("function");
    });
  });

  test("throws when model definition is not registered", async () => {
    await withModels(async ({ db }) => {
      expect(() => db.model(MissingDefinition)).toThrow();
    });
  });

  test("mergeAttributes updates the underlying record", async () => {
    await withModels(async ({ WidgetModel }) => {
      const widget = (await WidgetModel.find(1)) as WidgetModelBase | null;
      if (!widget) throw new Error("expected widget");
      widget.mergeAttributes({ name: "Renamed" });
      expect(widget.toObject().name).toBe("Renamed");
    });
  });

  test("loadHasMany attaches related records", async () => {
    await withModels(async ({ WidgetModel, tagRepository }) => {
      const widget = (await WidgetModel.find(1)) as WidgetModelBase | null;
      if (!widget) throw new Error("expected widget");

      const childRepository = tagRepository;

      const loaded = await widget.loadHasMany("tags", widgetHasTags, childRepository as never);
      expect(loaded.tags).toEqual([{ id: 10, widget_id: 1, label: "sale" }]);
    });
  });

  test("loadBelongsTo attaches the parent record", async () => {
    await withModels(async ({ TagModel, widgetRepository }) => {
      const tagRecord = { id: 10, widget_id: 1, label: "sale" };
      const tagModel = TagModel.hydrate(tagRecord);
      const loaded = await tagModel.loadBelongsTo("widget", widgetBelongsToTag, widgetRepository);
      expect(loaded.widget).toEqual({ id: 1, name: "Alpha" });
    });
  });

  test("default primaryKey uses the table primary key", async () => {
    await withModels(async ({ Tiny }) => {
      const model = Tiny.hydrate({ id: 1, name: "Broken" });
      expect(model.id).toBe(1);
    });
  });
});
