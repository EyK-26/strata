import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface NoteRecord {
  id: number;
  body: string;
  tenant_id: number;
  created_at: Date | string;
}

const notesTable = defineTable<NoteRecord, "id">({
  name: "notes",
  primaryKey: "id",
  columns: ["id", "body", "tenant_id", "created_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class NoteRepository extends BaseRepository<NoteRecord, "id"> {
  constructor() {
    super(notesTable);
  }
}

class Note extends Model<NoteRecord, "id"> {
  static $fillable = ["body", "tenant_id"] as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

registerModelRepository(Note, new NoteRepository());

export type { NoteRecord };
export { Note };
