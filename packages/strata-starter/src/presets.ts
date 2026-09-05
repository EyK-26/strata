import {
  type CorporateExtras,
  dockerLayerForNeeded,
  type ExampleAppId,
  type StarterLayers,
} from "./types.ts";

const noneExtras: CorporateExtras = {
  mfa: false,
  emailVerification: false,
  scim: false,
  metrics: false,
};

const enterpriseExtras: CorporateExtras = {
  mfa: true,
  emailVerification: true,
  scim: true,
  metrics: true,
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

function defaultLayers(): StarterLayers {
  return withDocker(
    {
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
  );
}

const EXAMPLE_APPS: Record<ExampleAppId, StarterLayers> = {
  "hiroapp-hobby": defaultLayers(),
  "hiroapp-team": withDocker(
    {
      frontend: "server-htmx",
      database: "postgres",
      auth: "cookie",
      tenancy: "none",
      cache: "redis",
      queue: "redis",
      mail: "log",
      spaPrefix: "/app",
      extras: { ...noneExtras, metrics: true },
    },
    true,
  ),
  hiroapp: withDocker(
    {
      frontend: "server-htmx",
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
};

function exampleAppLayers(id: ExampleAppId): StarterLayers {
  return structuredClone(EXAMPLE_APPS[id]);
}

export { defaultLayers, EXAMPLE_APPS, enterpriseExtras, exampleAppLayers, noneExtras };
