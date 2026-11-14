import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderNoteModel(plan: StarterFeaturePlan): string {
  const tenancyOn = plan.decisions.tenantTable;
  const tenantField = tenancyOn
    ? `
  tenant_id: number;`
    : "";
  const tenantColumn = tenancyOn ? ', "tenant_id"' : "";
  const fillable = tenancyOn ? '["body", "tenant_id"]' : '["body"]';
  return `import { createModel, type Model } from "@getstrata/core/database/model";
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

type Note = Model<NoteRecord, "id">;

const Note = createModel({
  name: "Note", table: notesTable,
  // created_at uses the table default; no client timestamp is sent.
  attributes: { fillable: ${fillable}, timestamps: false },
});
const NoteRepository = Note.repository;

export type { NoteRecord };
export { Note, NoteRepository };
`;
}

function renderUserModel(plan: StarterFeaturePlan): string {
  const layers = plan.layers;
  const tenancyOn = plan.decisions.schemaTenants;
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
  return `import { createModel, type Model } from "@getstrata/core/database/model";
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

type User = Model<UserRecord, "id">;

const User = createModel({
  name: "User", table: usersTable,
  // created_at uses the table default; no client timestamp is sent.
  attributes: { fillable: ${fillableLiteral}, hidden: ${hiddenLiteral}, timestamps: false },
});
const UserRepository = User.repository;

export type { UserRecord };
export { User, UserRepository };
`;
}

function renderApiTokenModel(): string {
  return `import { createModel, type Model } from "@getstrata/core/database/model";
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

type ApiToken = Model<ApiTokenRecord, "id">;

const ApiToken = createModel({
  name: "ApiToken", table: apiTokensTable,
  // created_at uses the table default; no client timestamp is sent.
  attributes: { fillable: ["user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at"], timestamps: false },
});
const ApiTokenRepository = ApiToken.repository;

export type { ApiTokenRecord };
export { ApiToken, ApiTokenRepository };
`;
}

function renderAuthOneTimeTokenModel(): string {
  return `import { createModel, type Model } from "@getstrata/core/database/model";
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

type AuthOneTimeToken = Model<AuthOneTimeTokenRecord, "id">;

const AuthOneTimeToken = createModel({
  name: "AuthOneTimeToken", table: authOneTimeTokensTable,
  attributes: { fillable: ["purpose", "user_id", "token_hash", "expires_at", "consumed_at"], timestamps: false },
});
const AuthOneTimeTokenRepository = AuthOneTimeToken.repository;

export type { AuthOneTimeTokenRecord };
export { AuthOneTimeToken, AuthOneTimeTokenRepository };
`;
}

function renderModelsRegister(plan: StarterFeaturePlan): string {
  const workTracker = plan.decisions.workTracker;
  const names = ["Note"];
  if (plan.decisions.users) names.push("User", "AuthOneTimeToken");
  if (plan.decisions.token) names.push("ApiToken");
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
