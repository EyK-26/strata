import { authNeedsUsers, authUsesToken, type StarterLayers, usesTenantTable } from "./types.ts";

function renderNoteModel(layers: StarterLayers): string {
  const tenancyOn = usesTenantTable(layers.tenancy);
  const tenantField = tenancyOn
    ? `
  tenant_id: number;`
    : "";
  const tenantColumn = tenancyOn ? ', "tenant_id"' : "";
  const fillable = tenancyOn ? '["body", "tenant_id"]' : '["body"]';
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
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

class NoteEntity extends Model<NoteRecord, "id"> {}
type Note = NoteEntity;

const NoteRepository = defineRepository<NoteRecord, "id", BaseRepository<NoteRecord, "id">, readonly []>({
  name: "NoteRepository", table: notesTable, dependencies: [],
  create: binding => new BaseRepository(binding),
});
const Note = defineModel<NoteRecord, "id", NoteEntity, BaseRepository<NoteRecord, "id">, readonly []>({
  name: "Note", repository: NoteRepository, dependencies: [],
  // created_at uses the table default; no client timestamp is sent.
  attributes: { fillable: ${fillable}, timestamps: false },
  construct: (state, binding) => new NoteEntity(state, binding),
});

export type { NoteRecord };
export { Note, NoteEntity, NoteRepository };
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
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
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

class UserEntity extends Model<UserRecord, "id"> {}
type User = UserEntity;

const UserRepository = defineRepository<UserRecord, "id", BaseRepository<UserRecord, "id">, readonly []>({
  name: "UserRepository", table: usersTable, dependencies: [],
  create: binding => new BaseRepository(binding),
});
const User = defineModel<UserRecord, "id", UserEntity, BaseRepository<UserRecord, "id">, readonly []>({
  name: "User", repository: UserRepository, dependencies: [],
  // created_at uses the table default; no client timestamp is sent.
  attributes: { fillable: ${fillableLiteral}, hidden: ${hiddenLiteral}, timestamps: false },
  construct: (state, binding) => new UserEntity(state, binding),
});

export type { UserRecord };
export { User, UserEntity, UserRepository };
`;
}

function renderApiTokenModel(): string {
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
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

class ApiTokenEntity extends Model<ApiTokenRecord, "id"> {}
type ApiToken = ApiTokenEntity;

const ApiTokenRepository = defineRepository<ApiTokenRecord, "id", BaseRepository<ApiTokenRecord, "id">, readonly []>({
  name: "ApiTokenRepository", table: apiTokensTable, dependencies: [],
  create: binding => new BaseRepository(binding),
});
const ApiToken = defineModel<ApiTokenRecord, "id", ApiTokenEntity, BaseRepository<ApiTokenRecord, "id">, readonly []>({
  name: "ApiToken", repository: ApiTokenRepository, dependencies: [],
  // created_at uses the table default; no client timestamp is sent.
  attributes: { fillable: ["user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at"], timestamps: false },
  construct: (state, binding) => new ApiTokenEntity(state, binding),
});

export type { ApiTokenRecord };
export { ApiToken, ApiTokenEntity, ApiTokenRepository };
`;
}

function renderAuthOneTimeTokenModel(): string {
  return `import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
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

class AuthOneTimeTokenEntity extends Model<AuthOneTimeTokenRecord, "id"> {}
type AuthOneTimeToken = AuthOneTimeTokenEntity;

const AuthOneTimeTokenRepository = defineRepository<AuthOneTimeTokenRecord, "id", BaseRepository<AuthOneTimeTokenRecord, "id">, readonly []>({
  name: "AuthOneTimeTokenRepository", table: authOneTimeTokensTable, dependencies: [],
  create: binding => new BaseRepository(binding),
});
const AuthOneTimeToken = defineModel<AuthOneTimeTokenRecord, "id", AuthOneTimeTokenEntity, BaseRepository<AuthOneTimeTokenRecord, "id">, readonly []>({
  name: "AuthOneTimeToken", repository: AuthOneTimeTokenRepository, dependencies: [],
  attributes: { fillable: ["purpose", "user_id", "token_hash", "expires_at", "consumed_at"], timestamps: false },
  construct: (state, binding) => new AuthOneTimeTokenEntity(state, binding),
});

export type { AuthOneTimeTokenRecord };
export { AuthOneTimeToken, AuthOneTimeTokenEntity, AuthOneTimeTokenRepository };
`;
}

function renderModelsRegister(layers: StarterLayers, workTracker = false): string {
  const names = ["Note"];
  if (authNeedsUsers(layers.auth)) names.push("User", "AuthOneTimeToken");
  if (authUsesToken(layers.auth)) names.push("ApiToken");
  return `${workTracker ? 'import { workTrackerRepositories } from "./workTracker.ts";\n' : ""}${names.map((name) => `import { ${name}, ${name}Repository } from "./${name}";`).join("\n")}

export const repositoryDefinitions = Object.freeze([${names.map((name) => `${name}Repository`).join(", ")}${workTracker ? ", ...workTrackerRepositories" : ""}]);
export const modelDefinitions = Object.freeze([${names.join(", ")}]);
`;
}

export {
  renderApiTokenModel,
  renderAuthOneTimeTokenModel,
  renderModelsRegister,
  renderNoteModel,
  renderUserModel,
};
