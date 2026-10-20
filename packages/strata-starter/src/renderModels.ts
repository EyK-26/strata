import { type StarterLayers, usesTenantTable } from "./types.ts";

function renderNoteModel(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy);
  const tenantField = tenancyOn
    ? `
  tenant_id: number;`
    : "";
  const tenantColumn = tenancyOn ? ', "tenant_id"' : "";
  const fillable = tenancyOn ? '["body", "tenant_id"]' : '["body"]';
  return `import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface NoteRecord {
  id: number;
  body: string;${tenantField}
  created_at: Date | string;
}

const notesTable = defineTable<NoteRecord, "id">({
  name: "notes",
  primaryKey: "id",
  columns: ["id", "body"${tenantColumn}, "created_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class Note extends defineModel(notesTable) {
  static $fillable = ${fillable} as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

export type { NoteRecord };
export { Note };
`;
}

function renderUserModel(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy) || layers.extras.scim;
  const mfaOn = Boolean(layers.extras.mfa);
  const tenantField = tenancyOn
    ? `
  tenant_id: number;`
    : "";
  const mfaFields = mfaOn
    ? `
  mfa_secret: string | null;
  mfa_enabled: number | boolean;
  mfa_recovery_codes: string | null;`
    : "";
  const columns = ["id", "name", "email", "password", "is_admin", "is_active", "auth_version"];
  if (tenancyOn) {
    columns.push("tenant_id");
  }
  if (mfaOn) {
    columns.push("mfa_secret", "mfa_enabled", "mfa_recovery_codes");
  }
  columns.push("session_valid_after", "email_verified_at", "created_at");
  const fillable = ["name", "email", "password", "is_admin", "is_active"];
  if (tenancyOn) {
    fillable.push("tenant_id");
  }
  if (mfaOn) {
    fillable.push("mfa_secret", "mfa_enabled", "mfa_recovery_codes");
  }
  fillable.push("session_valid_after", "email_verified_at");
  const hidden = ["password"];
  if (mfaOn) {
    hidden.push("mfa_secret", "mfa_recovery_codes");
  }
  const fillableLiteral = `[${fillable.map((column) => `"${column}"`).join(", ")}]`;
  const hiddenLiteral = `[${hidden.map((column) => `"${column}"`).join(", ")}]`;
  const columnsLiteral = columns.map((column) => `"${column}"`).join(", ");
  return `import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface UserRecord {
  id: number;
  name: string;
  email: string;
  password: string;
  is_active: number | boolean;
  auth_version: number;
  is_admin: number | boolean;${tenantField}${mfaFields}
  session_valid_after: Date | string | null;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

const usersTable = defineTable<UserRecord, "id">({
  name: "users",
  primaryKey: "id",
  columns: [${columnsLiteral}],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class User extends defineModel(usersTable) {
  static $fillable = ${fillableLiteral} as const;
  static $hidden = ${hiddenLiteral} as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

export type { UserRecord };
export { User };
`;
}

function renderApiTokenModel(): string {
  return `import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  abilities: string;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
}

const apiTokensTable = defineTable<ApiTokenRecord, "id">({
  name: "api_tokens",
  primaryKey: "id",
  columns: ["id", "user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at", "created_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class ApiToken extends defineModel(apiTokensTable) {
  static $fillable = ["user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at"] as const;
  // created_at uses the table default. Sending a JS Date from $timestamps
  // is rejected by SQLite bindings.
  static $timestamps = false;
}

export type { ApiTokenRecord };
export { ApiToken };
`;
}

function renderAuthOneTimeTokenModel(): string {
  return `import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

interface AuthOneTimeTokenRecord {
  id: number;
  purpose: string;
  user_id: number;
  token_hash: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

const authOneTimeTokensTable = defineTable<AuthOneTimeTokenRecord, "id">({
  name: "auth_one_time_tokens",
  primaryKey: "id",
  columns: ["id", "purpose", "user_id", "token_hash", "expires_at", "consumed_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class AuthOneTimeToken extends defineModel(authOneTimeTokensTable) {
  static $fillable = ["purpose", "user_id", "token_hash", "expires_at", "consumed_at"] as const;
  static $timestamps = false;
}

export type { AuthOneTimeTokenRecord };
export { AuthOneTimeToken };
`;
}

function renderModelsRegister(_layers: StarterLayers): string {
  return `import { discoverModels } from "@getstrata/bootstrap/discoverModels";

// Discovery binds default repositories and registers every name before model boot.
await discoverModels(import.meta.dir);
`;
}

export {
  renderApiTokenModel,
  renderAuthOneTimeTokenModel,
  renderModelsRegister,
  renderNoteModel,
  renderUserModel,
};
