const FRONTENDS = ["api", "server-htmx", "spa-react", "hybrid"] as const;
const DATABASES = ["sqlite", "postgres", "mysql"] as const;
const AUTH_STACKS = [
  "headers",
  "cookie",
  "token",
  "jwt",
  "cookie-token",
  "cookie-token-jwt",
] as const;
const TENANCY_DRIVERS = ["none", "column", "rls"] as const;
const CACHE_DRIVERS = ["array", "redis"] as const;
const QUEUE_DRIVERS = ["sync", "redis"] as const;
const MAIL_DRIVERS = ["log", "smtp"] as const;
const DOCKER_SERVICE_NAMES = ["postgres", "mysql", "redis", "mailpit"] as const;
const EXAMPLE_APP_IDS = ["hiroapp-hobby", "hiroapp-team", "hiroapp"] as const;

type FrontendMode = (typeof FRONTENDS)[number];
type DatabaseLayer = (typeof DATABASES)[number];
type AuthStack = (typeof AUTH_STACKS)[number];
type TenancyLayer = (typeof TENANCY_DRIVERS)[number];
type CacheLayer = (typeof CACHE_DRIVERS)[number];
type QueueLayer = (typeof QUEUE_DRIVERS)[number];
type MailLayer = (typeof MAIL_DRIVERS)[number];
type DockerServiceName = (typeof DOCKER_SERVICE_NAMES)[number];
type ExampleAppId = (typeof EXAMPLE_APP_IDS)[number];

const DOCKER_SERVICE_LABELS: Record<DockerServiceName, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
  redis: "Redis",
  mailpit: "SMTP (Mailpit)",
};

interface CorporateExtras {
  mfa: boolean;
  emailVerification: boolean;
  scim: boolean;
  metrics: boolean;
}

interface DockerLayer {
  enabled: boolean;
  services: Record<DockerServiceName, boolean>;
}

interface DockerNeedles {
  database: DatabaseLayer;
  cache: CacheLayer;
  queue: QueueLayer;
  mail: MailLayer;
}

interface StarterLayers {
  frontend: FrontendMode;
  database: DatabaseLayer;
  auth: AuthStack;
  tenancy: TenancyLayer;
  cache: CacheLayer;
  queue: QueueLayer;
  mail: MailLayer;
  spaPrefix: string;
  extras: CorporateExtras;
  docker: DockerLayer;
}

interface GenerateOptions {
  projectName: string;
  targetDir: string;
  layers: StarterLayers;
  templateRoot: string;
  overlayRoot: string;
  force?: boolean;
  workspaceDependencies?: boolean;
}

function authUsesCookie(auth: AuthStack): boolean {
  return auth === "cookie" || auth.startsWith("cookie-");
}

function authUsesToken(auth: AuthStack): boolean {
  return auth === "token" || auth.includes("token");
}

function authUsesJwt(auth: AuthStack): boolean {
  return auth === "jwt" || auth.endsWith("jwt");
}

function authNeedsUsers(auth: AuthStack): boolean {
  return auth !== "headers";
}

function usesTenantTable(tenancy: TenancyLayer): boolean {
  return tenancy === "rls" || tenancy === "column";
}

function htmlAuthKit(auth: AuthStack): boolean {
  return authUsesCookie(auth);
}

function needsRedis(layers: Pick<StarterLayers, "cache" | "queue">): boolean {
  return layers.cache === "redis" || layers.queue === "redis";
}

function emptyDockerServices(): Record<DockerServiceName, boolean> {
  return { postgres: false, mysql: false, redis: false, mailpit: false };
}

function enableDockerServices(
  names: readonly DockerServiceName[],
): Record<DockerServiceName, boolean> {
  const services = emptyDockerServices();
  for (const name of names) {
    services[name] = true;
  }
  return services;
}

function neededDockerServices(layers: DockerNeedles): DockerServiceName[] {
  const needed: DockerServiceName[] = [];
  if (layers.database === "postgres") {
    needed.push("postgres");
  }
  if (layers.database === "mysql") {
    needed.push("mysql");
  }
  if (needsRedis(layers)) {
    needed.push("redis");
  }
  if (layers.mail === "smtp") {
    needed.push("mailpit");
  }
  return needed;
}

function selectedDockerServices(layers: StarterLayers): DockerServiceName[] {
  if (!layers.docker.enabled) {
    return [];
  }
  return neededDockerServices(layers).filter((name) => layers.docker.services[name]);
}

function reconcileDocker(layers: StarterLayers): StarterLayers {
  const selected = selectedDockerServices(layers);
  return {
    ...layers,
    docker: {
      enabled: selected.length > 0,
      services: enableDockerServices(selected),
    },
  };
}

function dockerLayerForNeeded(layers: DockerNeedles, enabled: boolean): DockerLayer {
  const needed = neededDockerServices(layers);
  if (!enabled || needed.length === 0) {
    return { enabled: false, services: emptyDockerServices() };
  }
  return { enabled: true, services: enableDockerServices(needed) };
}

export type {
  AuthStack,
  CacheLayer,
  CorporateExtras,
  DatabaseLayer,
  DockerLayer,
  DockerServiceName,
  ExampleAppId,
  FrontendMode,
  GenerateOptions,
  MailLayer,
  QueueLayer,
  StarterLayers,
  TenancyLayer,
};
export {
  AUTH_STACKS,
  authNeedsUsers,
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  CACHE_DRIVERS,
  DATABASES,
  DOCKER_SERVICE_LABELS,
  DOCKER_SERVICE_NAMES,
  dockerLayerForNeeded,
  EXAMPLE_APP_IDS,
  emptyDockerServices,
  enableDockerServices,
  FRONTENDS,
  htmlAuthKit,
  MAIL_DRIVERS,
  neededDockerServices,
  needsRedis,
  QUEUE_DRIVERS,
  reconcileDocker,
  selectedDockerServices,
  TENANCY_DRIVERS,
  usesTenantTable,
};
