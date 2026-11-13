/** Compile-only exact bound persistence contracts; never executed. */

import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelBinding,
  type ModelState,
  type RepositoryBinding,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

type NoteRow = { id: number; title: string };
class Notes extends BaseRepository<NoteRow, "id"> {
  #label: string;
  constructor(binding: RepositoryBinding<NoteRow, "id">, label: string) {
    super(binding);
    this.#label = label;
  }
  label(): string {
    return this.#label;
  }
}
class Note extends Model<NoteRow, "id"> {
  #memo: string;
  constructor(
    state: ModelState<NoteRow>,
    binding: ModelBinding<NoteRow, "id", Notes>,
    source?: Note,
  ) {
    super(state, binding);
    this.#memo = source ? source.#memo : "new";
  }
  memo(): string {
    return this.#memo;
  }
}
class OtherNote extends Model<NoteRow, "id"> {
  #other = true;
  other(): boolean {
    return this.#other;
  }
}
const table = defineTable<NoteRow, "id">({
  name: "notes",
  primaryKey: "id",
  columns: ["id", "title"],
});
const notes = defineRepository<NoteRow, "id", Notes, readonly []>({
  name: "Notes",
  table,
  dependencies: [],
  create: (binding) => new Notes(binding, "notes"),
});
const note = defineModel<NoteRow, "id", Note, Notes, readonly []>({
  name: "Note",
  repository: notes,
  dependencies: [],
  attributes: { fillable: ["title"] },
  construct: (state, binding, source) => new Note(state, binding, source),
});

export function boundPersistenceContracts(
  db: DatabaseSession,
  tx: TransactionSession,
  source: Note,
  foreign: OtherNote,
  binding: RepositoryBinding<NoteRow, "id">,
) {
  const declarations = createDatabaseBindings({
    default: "main",
    repositories: [notes],
    models: [note],
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const repository: Notes = db.repository(notes);
  const same: Notes = tx.repository(notes);
  const entity: Note = tx.model(note).bind(source);
  const found: Promise<Note | null> = db.model(note).find(1);
  const run: Promise<string> = binding.run(() => repository.label());
  const projection: Promise<Pick<NoteRow, "title"> | null> = db
    .model(note)
    .query()
    .select("title")
    .first();
  void projection.then((row) => {
    if (!row) return;
    // @ts-expect-error Projected rows never carry mutable entity authority.
    row.save();
    // @ts-expect-error A projection cannot accidentally recover omitted row fields.
    row.id;
  });
  // @ts-expect-error A key must match the declared row primary key type.
  db.model(note).find("1");
  // @ts-expect-error Nominally distinct entity subclasses cannot be rebound as Note.
  tx.model(note).bind(foreign);
  // @ts-expect-error Canonical repositories require an explicit live binding.
  new BaseRepository<NoteRow, "id">();
  // @ts-expect-error Model static CRUD is removed; the session-bound facade owns it.
  Note.find(1);
  // @ts-expect-error A transaction cannot select a different pool.
  tx.connection("other");
  // @ts-expect-error A repository's supplied session authority is readonly.
  binding.session = tx;
  defineRepository<NoteRow, "id", Notes, readonly []>({
    name: "AsyncNotes",
    table,
    dependencies: [],
    // @ts-expect-error Repository factories construct synchronously.
    create: async (selected) => new Notes(selected, "async"),
  });
  defineModel<NoteRow, "id", Note, Notes, readonly []>({
    name: "AsyncNote",
    repository: notes,
    dependencies: [],
    attributes: {},
    // @ts-expect-error Entity constructors construct synchronously.
    construct: async (state, selected) => new Note(state, selected),
  });
  void [declarations, repository, same, entity, found, run, projection];
}

export function establishedTenantContract(
  established: import("@getstrata/bootstrap/persistenceContracts").EstablishedRequest,
) {
  const tenant: import("@getstrata/core/tenant/tenantContext").TenantContext = established.tenant;
  const id: number = established.tenant.id;
  const slug: string = established.tenant.slug;
  // @ts-expect-error Successfully established HTTP metadata never has a null tenant.
  const missing: typeof established.tenant = null;
  // @ts-expect-error A tenant cannot be omitted from a public established request.
  const omitted: typeof established.tenant = undefined;
  void [tenant, id, slug, missing, omitted];
}
