const FRONTENDS = ["api", "server-htmx", "spa-react", "hybrid"] as const;
const SCALES = ["hobby", "team", "enterprise"] as const;
const DATABASES = ["sqlite", "postgres", "mysql"] as const;
const AUTH_STACKS = [
  "headers",
  "cookie",
  "token",
  "jwt",
  "cookie-token",
  "cookie-token-jwt",
] as const;
const TENANCY_DRIVERS = ["none", "rls"] as const;
const CACHE_DRIVERS = ["array", "redis"] as const;
const QUEUE_DRIVERS = ["sync", "redis"] as const;
const MAIL_DRIVERS = ["log", "smtp"] as const;
const KITS = [
  "hobby",
  "team",
  "enterprise",
  "custom",
  "hiroapp-hobby",
  "hiroapp-team",
  "hiroapp-enterprise",
] as const;

type FrontendMode = (typeof FRONTENDS)[number];
type Scale = (typeof SCALES)[number];
type DatabaseLayer = (typeof DATABASES)[number];
type AuthStack = (typeof AUTH_STACKS)[number];
type TenancyLayer = (typeof TENANCY_DRIVERS)[number];
type CacheLayer = (typeof CACHE_DRIVERS)[number];
type QueueLayer = (typeof QUEUE_DRIVERS)[number];
type MailLayer = (typeof MAIL_DRIVERS)[number];
type KitId = (typeof KITS)[number];

interface CorporateExtras {
  mfa: boolean;
  emailVerification: boolean;
  scim: boolean;
  metrics: boolean;
  sqliteKiosk: boolean;
  mysqlMirror: boolean;
}

interface StarterLayers {
  kit: KitId;
  scale: Scale;
  frontend: FrontendMode;
  database: DatabaseLayer;
  auth: AuthStack;
  tenancy: TenancyLayer;
  cache: CacheLayer;
  queue: QueueLayer;
  mail: MailLayer;
  spaPrefix: string;
  extras: CorporateExtras;
}

interface GenerateOptions {
  projectName: string;
  targetDir: string;
  layers: StarterLayers;
  templateRoot: string;
  overlayRoot: string;
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

function needsRedis(layers: StarterLayers): boolean {
  return layers.cache === "redis" || layers.queue === "redis";
}

function isHiringRecipe(kit: KitId): boolean {
  return kit.startsWith("hiroapp-");
}

export type {
  AuthStack,
  CacheLayer,
  CorporateExtras,
  DatabaseLayer,
  FrontendMode,
  GenerateOptions,
  KitId,
  MailLayer,
  QueueLayer,
  Scale,
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
  FRONTENDS,
  isHiringRecipe,
  KITS,
  MAIL_DRIVERS,
  needsRedis,
  QUEUE_DRIVERS,
  SCALES,
  TENANCY_DRIVERS,
};
