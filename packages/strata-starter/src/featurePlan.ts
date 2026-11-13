import { validateSpaPrefix } from "@getstrata/core/runtime/frontendMode";
import {
  AUTH_STACKS,
  authNeedsUsers,
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  CACHE_DRIVERS,
  type CorporateExtras,
  DATABASES,
  DOCKER_SERVICE_NAMES,
  type DockerServiceName,
  extraApplies,
  FRONTENDS,
  MAIL_DRIVERS,
  neededDockerServices,
  needsFrontendBuild,
  QUEUE_DRIVERS,
  type StarterLayers,
  selectedDockerServices,
  TENANCY_DRIVERS,
  usesTenantTable,
} from "./types.ts";

type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };

export interface FeatureRequirement {
  readonly feature:
    | keyof CorporateExtras
    | "tenancy:rls"
    | "reference:work-tracker"
    | "auth:accounts";
  readonly capability:
    | "database:postgres"
    | "auth:cookie"
    | "auth:users"
    | "tenancy:enabled"
    | "config:signed-urls";
}

/** Known starter capabilities, compiled once before generation acquires an output directory. */
export interface StarterFeaturePlan {
  readonly version: 1;
  readonly reference?: "work-tracker";
  readonly layers: Immutable<StarterLayers>;
  readonly requirements: readonly FeatureRequirement[];
  readonly conflicts: readonly string[];
  readonly decisions: Readonly<{
    rls: boolean;
    sqlDriver: "pgsql" | "mysql" | "sqlite";
    rowLocks: boolean;
    schemaTenants: boolean;
    mfa: boolean;
    emailVerification: boolean;
    scim: boolean;
    github: boolean;
    oidc: boolean;
    bearerApi: boolean;
    jsonCookieAccounts: boolean;
    jsonAccounts: boolean;
    mfaViews: boolean;
    serverViews: boolean;
    apiDocs: boolean;
    mysqlDependency: boolean;
    redisQueue: boolean;
    redis: boolean;
    composeUpCommand: string;
    workTracker: boolean;
    authMechanisms: readonly string[];
    sessionSecret: boolean;
    tenantUsers: boolean;
    cookieVerification: boolean;
    jsonVerification: boolean;
    cookieJsonLogin: boolean;
    htmlCookieAccounts: boolean;
    ensureDatabase: boolean;
    signedUrls: boolean;
    dedicatedSigningSecret: boolean;
    users: boolean;
    cookie: boolean;
    token: boolean;
    jwt: boolean;
    htmlAuth: boolean;
    frontendBuild: boolean;
    tenantTable: boolean;
    pendingMfa: boolean;
    browserTransport: "cookie" | "token" | "jwt" | "headers";
  }>;
  readonly services: Readonly<{
    required: readonly DockerServiceName[];
    docker: readonly DockerServiceName[];
    local: readonly DockerServiceName[];
  }>;
  /** Required feature-controlled outputs; template assets are inventoried after rendering. */
  readonly artifacts: readonly string[];
}

const EXTRA_KEYS: readonly (keyof CorporateExtras)[] = [
  "mfa",
  "emailVerification",
  "scim",
  "metrics",
  "oauthGithub",
  "oidc",
  "billing",
  "webhooks",
];

export function compileStarterFeatures(
  input: StarterLayers,
  reference?: "work-tracker",
): StarterFeaturePlan {
  if (reference !== undefined && reference !== "work-tracker")
    throw new Error("Unknown reference domain.");
  if (!input || typeof input !== "object") throw new Error("Starter layers are required.");
  const choices = {
    frontend: FRONTENDS,
    database: DATABASES,
    auth: AUTH_STACKS,
    tenancy: TENANCY_DRIVERS,
    cache: CACHE_DRIVERS,
    queue: QUEUE_DRIVERS,
    mail: MAIL_DRIVERS,
  };
  for (const [key, values] of Object.entries(choices)) {
    if (!(values as readonly unknown[]).includes(input[key as keyof typeof choices])) {
      throw new Error(`Invalid starter ${key}.`);
    }
  }
  if (!input.extras || !input.docker?.services) {
    throw new Error("Starter extras and Docker service selections are required.");
  }
  for (const key of EXTRA_KEYS) {
    if (typeof input.extras[key] !== "boolean") throw new Error(`Invalid starter extra ${key}.`);
  }
  if (typeof input.docker.enabled !== "boolean") throw new Error("Invalid Docker enabled flag.");
  for (const key of DOCKER_SERVICE_NAMES) {
    if (typeof input.docker.services[key] !== "boolean")
      throw new Error(`Invalid Docker service ${key}.`);
  }
  const conflicts: string[] = [];
  const requirements: FeatureRequirement[] = [];
  if (input.tenancy === "rls") {
    requirements.push({ feature: "tenancy:rls", capability: "database:postgres" });
    if (input.database !== "postgres") conflicts.push("RLS tenancy requires PostgreSQL.");
  }
  for (const key of EXTRA_KEYS) {
    if (!input.extras[key]) continue;
    if (!["metrics", "billing", "webhooks"].includes(key)) {
      requirements.push({
        feature: key,
        capability: ["mfa", "oauthGithub", "oidc"].includes(key) ? "auth:cookie" : "auth:users",
      });
    }
    if (!extraApplies(key, input.auth))
      conflicts.push(`${key} is unsupported with ${input.auth} authentication.`);
  }
  if (reference === "work-tracker") {
    requirements.push(
      { feature: "reference:work-tracker", capability: "auth:users" },
      { feature: "reference:work-tracker", capability: "tenancy:enabled" },
    );
    if (!authNeedsUsers(input.auth) || !usesTenantTable(input.tenancy))
      conflicts.push("Work tracker requires user authentication and tenant isolation.");
  }
  if (conflicts.length) throw new Error(`Invalid starter feature plan: ${conflicts.join(" ")}`);
  const layers = Object.freeze({
    frontend: input.frontend,
    database: input.database,
    auth: input.auth,
    tenancy: input.tenancy,
    cache: input.cache,
    queue: input.queue,
    mail: input.mail,
    spaPrefix: validateSpaPrefix(input.spaPrefix),
    extras: Object.freeze(
      Object.fromEntries(
        EXTRA_KEYS.map((key) => [key, input.extras[key]]),
      ) as unknown as CorporateExtras,
    ),
    docker: Object.freeze({
      enabled: input.docker.enabled,
      services: Object.freeze(
        Object.fromEntries(
          DOCKER_SERVICE_NAMES.map((key) => [key, input.docker.services[key]]),
        ) as StarterLayers["docker"]["services"],
      ),
    }),
  });
  const users = authNeedsUsers(layers.auth);
  const cookie = authUsesCookie(layers.auth);
  const token = authUsesToken(layers.auth);
  const jwt = authUsesJwt(layers.auth);
  const tenantTable = usesTenantTable(layers.tenancy);
  const serverViews = layers.frontend === "server-htmx" || layers.frontend === "hybrid";
  const bearerApi = token || jwt;
  const jsonCookieAccounts = cookie && layers.frontend !== "server-htmx";
  if (users) requirements.push({ feature: "auth:accounts", capability: "config:signed-urls" });
  const required = neededDockerServices(layers);
  const docker = selectedDockerServices(layers);
  const decisions = Object.freeze({
    workTracker: reference === "work-tracker",
    authMechanisms: Object.freeze([
      ...(token ? ["api", "basic"] : []),
      ...(jwt ? ["jwt", ...(token ? [] : ["basic"])] : []),
      ...(cookie ? ["session"] : []),
    ]),
    sessionSecret: cookie || serverViews,
    tenantUsers: tenantTable && users,
    cookieVerification: cookie && layers.extras.emailVerification,
    jsonVerification: (bearerApi || jsonCookieAccounts) && layers.extras.emailVerification,
    cookieJsonLogin: cookie && !bearerApi,
    htmlCookieAccounts: cookie && serverViews,
    ensureDatabase: layers.database !== "sqlite",
    signedUrls: users,
    dedicatedSigningSecret: users && !cookie && !serverViews,
    rls: layers.tenancy === "rls",
    sqlDriver: layers.database === "postgres" ? ("pgsql" as const) : layers.database,
    rowLocks: layers.database !== "sqlite",
    schemaTenants: tenantTable || layers.extras.scim,
    mfa: layers.extras.mfa && users,
    emailVerification: layers.extras.emailVerification && users,
    scim: layers.extras.scim && users,
    github: layers.extras.oauthGithub && cookie,
    oidc: layers.extras.oidc && cookie,
    bearerApi,
    jsonCookieAccounts,
    jsonAccounts: bearerApi || jsonCookieAccounts,
    mfaViews: layers.extras.mfa && cookie && !serverViews,
    serverViews,
    apiDocs: layers.frontend === "api",
    mysqlDependency: layers.database === "mysql",
    redisQueue: layers.queue === "redis",
    redis: layers.cache === "redis" || layers.queue === "redis",
    composeUpCommand: docker.includes("adminer")
      ? "docker compose --profile debug up -d --wait --wait-timeout 180"
      : "docker compose up -d --wait --wait-timeout 180",
    users,
    cookie,
    token,
    jwt,
    htmlAuth: cookie,
    frontendBuild: needsFrontendBuild(layers.frontend),
    tenantTable,
    pendingMfa: layers.extras.mfa && cookie,
    browserTransport: cookie ? ("cookie" as const) : (layers.auth as "token" | "jwt" | "headers"),
  });
  const artifacts = [
    "package.json",
    "src/bootstrap/createApp.ts",
    "src/models/Note.ts",
    "src/models/register.ts",
    "src/db/migrations/0001_starter_schema.ts",
  ];
  if (decisions.users)
    artifacts.push(
      "src/models/User.ts",
      "src/models/AuthOneTimeToken.ts",
      "src/db/migrations/0006_account_state.ts",
    );
  if (decisions.token) artifacts.push("src/models/ApiToken.ts");
  if (decisions.frontendBuild)
    artifacts.push("frontend/src/auth/config.ts", "frontend/src/config.ts");
  if (decisions.htmlAuth)
    artifacts.push(
      "views/auth/login.eta",
      "views/auth/register.eta",
      "views/auth/forgot-password.eta",
      "views/auth/reset-password.eta",
    );
  if (decisions.pendingMfa)
    artifacts.push(
      "src/bootstrap/pendingMfa.ts",
      "views/auth/mfa-challenge.eta",
      "views/auth/mfa-setup.eta",
      "views/auth/confirm-password.eta",
    );
  if (decisions.htmlAuth && layers.extras.emailVerification)
    artifacts.push("views/auth/verify-email.eta");
  if (layers.extras.scim) artifacts.push("src/modules/scim/index.ts");
  if (layers.extras.billing)
    artifacts.push("src/billing/applyStripeWebhook.ts", "src/modules/billing/index.ts");
  if (layers.extras.webhooks)
    artifacts.push(
      "src/jobs/dispatchOutboundWebhookJob.ts",
      "src/listeners/noteCreatedWebhookListener.ts",
    );
  if (decisions.workTracker)
    artifacts.push(
      "docs/WORK_TRACKER.md",
      "src/domain/workTracker.ts",
      "src/models/workTracker.ts",
      "src/modules/workTracker/index.ts",
      "src/db/migrations/0007_work_tracker.ts",
    );
  return Object.freeze({
    version: 1,
    ...(reference ? { reference } : {}),
    layers,
    decisions,
    requirements: Object.freeze(requirements.map((rule) => Object.freeze(rule))),
    conflicts: Object.freeze(conflicts),
    services: Object.freeze({
      required: Object.freeze(required),
      docker: Object.freeze(docker),
      local: Object.freeze(required.filter((service) => !docker.includes(service))),
    }),
    artifacts: Object.freeze(artifacts.sort()),
  });
}
