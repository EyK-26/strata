import type { StarterFeaturePlan } from "./featurePlan.ts";

/** A single typed field declaration supplies the row type and runtime column metadata. */
function renderModel(
  name: string,
  table: string,
  fields: Record<string, string>,
  fillable: readonly string[],
  hidden: readonly string[] = [],
): string {
  return `import { defineModel, field, type ModelAttributes } from "@getstrata/core/database/model";

class ${name} extends defineModel({
  table: "${table}",
  fields: {
${Object.entries(fields)
  .map(([column, type]) => `    ${column}: ${type},`)
  .join("\n")}
  },
  defaultOrderBy: { column: "id", direction: "ASC" },
}) {
  static $fillable = ${JSON.stringify(fillable)} as const;
${hidden.length ? `  static $hidden = ${JSON.stringify(hidden)} as const;\n` : ""}  // Timestamp columns use database defaults; no client timestamp is sent.
  static $timestamps = false;
}

type ${name}Record = ModelAttributes<${name}>;
export type { ${name}Record };
export { ${name} };
`;
}

function renderNoteModel(plan: StarterFeaturePlan): string {
  const tenant = plan.decisions.tenantTable;
  return renderModel(
    "Note",
    "notes",
    {
      id: "field.number()",
      body: "field.string()",
      ...(tenant ? { tenant_id: "field.number()" } : {}),
      created_at: "field.timestamp()",
    },
    ["body", ...(tenant ? ["tenant_id"] : [])],
  );
}

function renderUserModel(plan: StarterFeaturePlan): string {
  const tenant = plan.decisions.schemaTenants;
  const mfa = plan.layers.extras.mfa;
  return renderModel(
    "User",
    "users",
    {
      id: "field.number()",
      name: "field.string()",
      email: "field.string()",
      password: "field.string()",
      is_admin: "field.boolean()",
      is_active: "field.boolean()",
      auth_version: "field.number()",
      ...(tenant ? { tenant_id: "field.number()" } : {}),
      ...(mfa
        ? {
            mfa_secret: "field.nullable(field.string())",
            mfa_enabled: "field.boolean()",
            mfa_recovery_codes: "field.nullable(field.string())",
          }
        : {}),
      session_valid_after: "field.nullable(field.timestamp())",
      email_verified_at: "field.nullable(field.timestamp())",
      created_at: "field.timestamp()",
    },
    [
      "name",
      "email",
      "password",
      "is_admin",
      "is_active",
      ...(tenant ? ["tenant_id"] : []),
      ...(mfa ? ["mfa_secret", "mfa_enabled", "mfa_recovery_codes"] : []),
      "session_valid_after",
      "email_verified_at",
    ],
    ["password", ...(mfa ? ["mfa_secret", "mfa_recovery_codes"] : [])],
  );
}

function renderApiTokenModel(): string {
  return renderModel(
    "ApiToken",
    "api_tokens",
    {
      id: "field.number()",
      user_id: "field.number()",
      name: "field.string()",
      token_hash: "field.string()",
      abilities: "field.string()",
      expires_at: "field.nullable(field.timestamp())",
      last_used_at: "field.nullable(field.timestamp())",
      created_at: "field.timestamp()",
    },
    ["user_id", "name", "token_hash", "abilities", "expires_at", "last_used_at"],
  );
}

function renderAuthOneTimeTokenModel(): string {
  return renderModel(
    "AuthOneTimeToken",
    "auth_one_time_tokens",
    {
      id: "field.number()",
      purpose: "field.string()",
      user_id: "field.number()",
      token_hash: "field.string()",
      expires_at: "field.timestamp()",
      consumed_at: "field.nullable(field.timestamp())",
    },
    ["purpose", "user_id", "token_hash", "expires_at", "consumed_at"],
  );
}

function renderModelsRegister(plan: StarterFeaturePlan): string {
  const names = ["Note"];
  if (plan.decisions.users) names.push("User", "AuthOneTimeToken");
  if (plan.decisions.token) names.push("ApiToken");
  return `${names.map((name) => `import { ${name} } from "./${name}";`).join("\n")}

export const modelDefinitions = Object.freeze([${names.join(", ")}]);
${plan.decisions.workTracker ? '\n// This optional domain example supplies custom data-access repositories.\nexport { workTrackerRepositories as repositoryDefinitions } from "./workTracker.ts";\n' : ""}`;
}

export {
  renderApiTokenModel,
  renderAuthOneTimeTokenModel,
  renderModelsRegister,
  renderNoteModel,
  renderUserModel,
};
