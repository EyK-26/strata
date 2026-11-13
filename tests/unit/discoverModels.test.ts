import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverModels } from "@getstrata/bootstrap/discoverModels";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { withBoundDatabase } from "../helpers/boundRepositoryHarness";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "strata-model-discovery-"));
  directories.push(path);
  return path;
}
const modelUrl = pathToFileURL(join(import.meta.dir, "../../src/core/database/model.ts")).href;
const tableUrl = pathToFileURL(join(import.meta.dir, "../../src/core/database/table.ts")).href;
const definitionsUrl = pathToFileURL(
  join(import.meta.dir, "../../src/core/database/definitions.ts"),
).href;
const repositoryUrl = pathToFileURL(
  join(import.meta.dir, "../../src/core/database/baseRepository.ts"),
).href;
const imports = `import {Model} from ${JSON.stringify(modelUrl)};
import {BaseRepository} from ${JSON.stringify(repositoryUrl)};
import {defineModel,defineRepository} from ${JSON.stringify(definitionsUrl)};
import {defineTable} from ${JSON.stringify(tableUrl)};
type Row={id:number};
const table=defineTable<Row,"id">({name:"discovered",primaryKey:"id",columns:["id"]});`;

describe("model discovery", () => {
  test("loads nested named/default definitions, deduplicates identity, and constructs after all names exist", async () => {
    const path = await directory();
    await mkdir(join(path, "nested"));
    await writeFile(
      join(path, "Parent.ts"),
      `${imports}
export class ParentEntity extends Model<Row,"id"> { children(){return this.hasMany("discovered-child");} }
export let constructions=0;
export const repository=defineRepository({name:"ParentRepository",table,dependencies:[],create:binding=>new BaseRepository(binding)});
export const DiscoveredParent=defineModel({name:"DiscoveredParent",repository,dependencies:[],attributes:{timestamps:false},construct:(state,binding)=>{constructions++;return new ParentEntity(state,binding);}});
export default DiscoveredParent;
export const notAModel = () => {};
`,
    );
    await writeFile(
      join(path, "nested/Child.ts"),
      `${imports}
class ChildEntity extends Model<Row,"id"> {}
const repository=defineRepository({name:"ChildRepository",table,dependencies:[],create:binding=>new BaseRepository(binding)});
export const DiscoveredChild=defineModel({name:"DiscoveredChild",aliases:["discovered-child"],repository,dependencies:[],attributes:{timestamps:false},construct:(state,binding)=>new ChildEntity(state,binding)});
`,
    );
    // The generated caller awaits discovery; importing it again would deadlock.
    await writeFile(
      join(path, "register.ts"),
      `import { discoverModels } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "../../src/bootstrap/discoverModels.ts")).href)};
export const models = await discoverModels(import.meta.dir);
`,
    );
    await writeFile(join(path, "types.d.ts"), 'throw new Error("declarations must not execute");');
    await writeFile(join(path, "types.d.mts"), 'throw new Error("declarations must not execute");');
    await writeFile(join(path, "index.ts"), 'throw new Error("barrel must not execute");');
    await writeFile(join(path, "ignored.txt"), 'throw new Error("not JavaScript");');
    await symlink(join(path, "register.ts"), join(path, "linked.ts"));
    const loaded = await import(pathToFileURL(join(path, "register.ts")).href);
    expect(loaded.models).toHaveLength(2);
    const parent = await import(pathToFileURL(join(path, "Parent.ts")).href);
    expect(parent.constructions).toBe(0);
    await Promise.all([discoverModels(path), discoverModels(path)]);
    expect(parent.constructions).toBe(0);
    expect(parent.DiscoveredParent.repository.table.name).toBe("discovered");
    await withBoundDatabase(
      {
        definition: {
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          repositories: loaded.models.map(
            (definition: { repository: never }) => definition.repository,
          ),
          models: loaded.models,
        },
      },
      async (database) => {
        const entity = database.model(parent.DiscoveredParent).newRecord({ id: 1 });
        expect(Reflect.get(entity, "children").call(entity)).toBeDefined();
        expect(parent.constructions).toBe(1);
      },
    );
  });

  test("defaults to the application models directory", async () => {
    const path = await directory();
    await mkdir(join(path, "src/models"), { recursive: true });
    const previous = process.cwd();
    try {
      process.chdir(path);
      expect(await discoverModels()).toEqual([]);
    } finally {
      process.chdir(previous);
    }
  });

  test("supports explicit exclusions and propagates import and missing-directory errors", async () => {
    const path = await directory();
    await writeFile(join(path, "bad.ts"), 'throw new Error("model import failed");');
    expect(await discoverModels(path, { exclude: ["bad.ts"] })).toEqual([]);
    await expect(discoverModels(path)).rejects.toThrow("model import failed");
    await expect(discoverModels(join(path, "missing"))).rejects.toThrow();
  });

  test("rejects ambiguous relationship names before constructing bound entities", async () => {
    const path = await directory();
    for (const file of ["First.ts", "Second.ts"]) {
      await writeFile(
        join(path, file),
        `${imports}
class Entity extends Model<Row,"id"> {}
const repository=defineRepository({name:"${file}Repository",table,dependencies:[],create:binding=>new BaseRepository(binding)});
export const AmbiguousModel=defineModel({name:"AmbiguousModel",repository,dependencies:[],attributes:{},construct:()=>{throw new Error("construct should not run");}});
`,
      );
    }
    const discovered = await discoverModels(path);
    expect(() =>
      createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: discovered.map((definition) => definition.repository),
        models: discovered,
      }),
    ).toThrow("Duplicate model alias");
  });

  test("unconfigured exported model definitions fail startup rather than disappear silently", async () => {
    const path = await directory();
    await writeFile(
      join(path, "Legacy.ts"),
      `${imports}
export const UnconfiguredModel=defineModel({name:"UnconfiguredModel",repository:undefined,dependencies:[],attributes:{},construct:()=>{throw new Error("construct should not run");}});`,
    );
    await expect(discoverModels(path)).rejects.toThrow("Expected original database definition");
  });
});
