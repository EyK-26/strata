import {
  type CorporateExtras,
  dockerLayerForNeeded,
  type KitId,
  type StarterLayers,
} from "./types.ts";

const noneExtras: CorporateExtras = {
  mfa: false,
  emailVerification: false,
  scim: false,
  metrics: false,
  sqliteKiosk: false,
  mysqlMirror: false,
};

const teamExtras: CorporateExtras = {
  ...noneExtras,
  metrics: true,
};

const enterpriseExtras: CorporateExtras = {
  mfa: true,
  emailVerification: true,
  scim: true,
  metrics: true,
  sqliteKiosk: true,
  mysqlMirror: true,
};

function withDocker(
  layers: Omit<StarterLayers, "docker">,
  composeForNeededTools: boolean,
): StarterLayers {
  return {
    ...layers,
    docker: dockerLayerForNeeded(layers, composeForNeededTools),
  };
}

const PRESETS: Record<Exclude<KitId, "custom">, StarterLayers> = {
  hobby: withDocker(
    {
      kit: "hobby",
      scale: "hobby",
      frontend: "api",
      database: "sqlite",
      auth: "headers",
      tenancy: "none",
      cache: "array",
      queue: "sync",
      mail: "log",
      spaPrefix: "/app",
      extras: { ...noneExtras },
    },
    false,
  ),
  team: withDocker(
    {
      kit: "team",
      scale: "team",
      frontend: "server-htmx",
      database: "postgres",
      auth: "cookie",
      tenancy: "none",
      cache: "redis",
      queue: "redis",
      mail: "log",
      spaPrefix: "/app",
      extras: { ...teamExtras },
    },
    true,
  ),
  enterprise: withDocker(
    {
      kit: "enterprise",
      scale: "enterprise",
      frontend: "hybrid",
      database: "postgres",
      auth: "cookie-token-jwt",
      tenancy: "rls",
      cache: "redis",
      queue: "redis",
      mail: "smtp",
      spaPrefix: "/app",
      extras: { ...enterpriseExtras },
    },
    true,
  ),
  "hiroapp-hobby": withDocker(
    {
      kit: "hiroapp-hobby",
      scale: "hobby",
      frontend: "hybrid",
      database: "sqlite",
      auth: "cookie-token",
      tenancy: "none",
      cache: "array",
      queue: "sync",
      mail: "log",
      spaPrefix: "/apply",
      extras: { ...noneExtras },
    },
    false,
  ),
  "hiroapp-team": withDocker(
    {
      kit: "hiroapp-team",
      scale: "team",
      frontend: "hybrid",
      database: "postgres",
      auth: "cookie-token",
      tenancy: "none",
      cache: "redis",
      queue: "redis",
      mail: "log",
      spaPrefix: "/apply",
      extras: { ...teamExtras },
    },
    true,
  ),
  "hiroapp-enterprise": withDocker(
    {
      kit: "hiroapp-enterprise",
      scale: "enterprise",
      frontend: "hybrid",
      database: "postgres",
      auth: "cookie-token-jwt",
      tenancy: "rls",
      cache: "redis",
      queue: "redis",
      mail: "smtp",
      spaPrefix: "/apply",
      extras: { ...enterpriseExtras },
    },
    true,
  ),
};

function presetLayers(kit: Exclude<KitId, "custom">): StarterLayers {
  return structuredClone(PRESETS[kit]);
}

export { noneExtras, PRESETS, presetLayers };
