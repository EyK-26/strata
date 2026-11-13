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
  htmlAuthKit,
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
  readonly feature: keyof CorporateExtras | "tenancy:rls";
  readonly capability: "database:postgres" | "auth:cookie" | "auth:users";
}

/** Known starter capabilities, compiled once before generation acquires an output directory. */
export interface StarterFeaturePlan {
  readonly version: 1;
  readonly layers: Immutable<StarterLayers>;
  readonly requirements: readonly FeatureRequirement[];
  readonly conflicts: readonly string[];
  readonly decisions: Readonly<{
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

export function compileStarterFeatures(input: StarterLayers): StarterFeaturePlan {
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
  const decisions = Object.freeze({
    users: authNeedsUsers(layers.auth),
    cookie: authUsesCookie(layers.auth),
    token: authUsesToken(layers.auth),
    jwt: authUsesJwt(layers.auth),
    htmlAuth: htmlAuthKit(layers.auth),
    frontendBuild: needsFrontendBuild(layers.frontend),
    tenantTable: usesTenantTable(layers.tenancy),
    pendingMfa: layers.extras.mfa && htmlAuthKit(layers.auth),
    browserTransport: authUsesCookie(layers.auth)
      ? ("cookie" as const)
      : (layers.auth as "token" | "jwt" | "headers"),
  });
  const required = neededDockerServices(layers);
  const docker = selectedDockerServices(layers);
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
  return Object.freeze({
    version: 1,
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
