import { presetLayers } from "./presets.ts";
import {
  AUTH_STACKS,
  type AuthStack,
  CACHE_DRIVERS,
  type CacheLayer,
  DATABASES,
  type DatabaseLayer,
  FRONTENDS,
  type FrontendMode,
  KITS,
  type KitId,
  MAIL_DRIVERS,
  type MailLayer,
  QUEUE_DRIVERS,
  type QueueLayer,
  type StarterLayers,
  TENANCY_DRIVERS,
  type TenancyLayer,
} from "./types.ts";

const KIT_ALIASES: Record<string, KitId> = {
  hobby: "hobby",
  team: "team",
  enterprise: "enterprise",
  custom: "custom",
  "hiroapp-hobby": "hiroapp-hobby",
  "hiroapp-team": "hiroapp-team",
  "hiroapp-enterprise": "hiroapp-enterprise",
  hiroapp_hobby: "hiroapp-hobby",
  hiroapp_team: "hiroapp-team",
  hiroapp_enterprise: "hiroapp-enterprise",
  hiroapp_build_from_starter_kit_hobby: "hiroapp-hobby",
  hiroapp_build_from_starter_kit_team: "hiroapp-team",
  hiroapp_build_from_starter_kit_enterprise: "hiroapp-enterprise",
  hiroapp_build_from_starter_kit_x_level_hobby: "hiroapp-hobby",
  hiroapp_build_from_starter_kit_x_level_team: "hiroapp-team",
  hiroapp_build_from_starter_kit_x_level_enterprise: "hiroapp-enterprise",
  hiroapp_build_from_starter_kit_x_level_entreprise: "hiroapp-enterprise",
};

interface ParsedFlags {
  help: boolean;
  yes: boolean;
  noInteractive: boolean;
  corporate: boolean;
  projectName?: string;
  kit?: KitId;
  frontend?: FrontendMode;
  database?: DatabaseLayer;
  auth?: AuthStack;
  tenancy?: TenancyLayer;
  cache?: CacheLayer;
  queue?: QueueLayer;
  mail?: MailLayer;
  spaPrefix?: string;
  extras: Partial<StarterLayers["extras"]>;
}

function usage(): string {
  return `Usage: create-strata [project-name] [options]

Scaffold a runnable Strata app. Interactive in a terminal. For CI, pass --yes and --kit.

Kits:
  hobby, team, enterprise, custom
  hiroapp-hobby, hiroapp-team, hiroapp-enterprise

Hiring recipe aliases:
  hiroapp_build_from_starter_kit_x_level_hobby
  hiroapp_build_from_starter_kit_x_level_team
  hiroapp_build_from_starter_kit_x_level_enterprise

Options:
  --kit, --preset     Kit or hiring recipe
  --frontend          api | server-htmx | spa-react | hybrid
  --database          sqlite | postgres | mysql
  --auth              headers | cookie | token | jwt | cookie-token | cookie-token-jwt
  --tenancy           none | rls
  --cache             array | redis
  --queue             sync | redis
  --mail              log | smtp
  --spa-prefix        SPA URL prefix (default /app, hiring recipes /apply)
  --mfa / --no-mfa
  --email-verification / --no-email-verification
  --scim / --no-scim
  --metrics / --no-metrics
  --kiosk / --no-kiosk
  --mysql-mirror / --no-mysql-mirror
  --corporate         Prompt (or enable) enterprise extras on any kit
  --yes, --no-interactive
  -h, --help

Examples:
  bunx create-strata my-app
  bunx create-strata my-app --kit hobby --yes
  bunx create-strata hiring --kit hiroapp-enterprise --yes
`;
}

function takeValue(arg: string, prefix: string): string | undefined {
  if (arg.startsWith(`${prefix}=`)) {
    return arg.slice(prefix.length + 1);
  }
  return undefined;
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unknown ${label} "${value}". Expected ${allowed.join(", ")}.`);
}

function parseKit(value: string): KitId {
  const normalized = value.trim().toLowerCase().replace(/[./]/g, "_");
  const kit = KIT_ALIASES[normalized] ?? KIT_ALIASES[value.trim().toLowerCase()];
  if (!kit) {
    throw new Error(
      `Unknown kit "${value}". Expected ${KITS.join(", ")} or a hiring recipe alias.`,
    );
  }
  return kit;
}

function parseCreateStrataArgs(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = {
    help: false,
    yes: false,
    noInteractive: false,
    corporate: false,
    extras: {},
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    if (arg === "--no-interactive") {
      flags.noInteractive = true;
      continue;
    }
    if (arg === "--corporate") {
      flags.corporate = true;
      continue;
    }

    const boolFlags: Array<[string, keyof StarterLayers["extras"], boolean]> = [
      ["--mfa", "mfa", true],
      ["--no-mfa", "mfa", false],
      ["--email-verification", "emailVerification", true],
      ["--no-email-verification", "emailVerification", false],
      ["--scim", "scim", true],
      ["--no-scim", "scim", false],
      ["--metrics", "metrics", true],
      ["--no-metrics", "metrics", false],
      ["--kiosk", "sqliteKiosk", true],
      ["--no-kiosk", "sqliteKiosk", false],
      ["--mysql-mirror", "mysqlMirror", true],
      ["--no-mysql-mirror", "mysqlMirror", false],
    ];
    const boolMatch = boolFlags.find(([name]) => name === arg);
    if (boolMatch) {
      flags.extras[boolMatch[1]] = boolMatch[2];
      continue;
    }

    const kit = takeValue(arg, "--kit") ?? takeValue(arg, "--preset");
    if (kit !== undefined) {
      flags.kit = parseKit(kit);
      continue;
    }
    if (arg === "--kit" || arg === "--preset") {
      flags.kit = parseKit(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    const pairs: Array<[string, (value: string) => void]> = [
      [
        "--frontend",
        (value) => {
          flags.frontend = parseEnum(value, FRONTENDS, "frontend");
        },
      ],
      [
        "--database",
        (value) => {
          flags.database = parseEnum(value, DATABASES, "database");
        },
      ],
      [
        "--auth",
        (value) => {
          flags.auth = parseEnum(value, AUTH_STACKS, "auth");
        },
      ],
      [
        "--tenancy",
        (value) => {
          flags.tenancy = parseEnum(value, TENANCY_DRIVERS, "tenancy");
        },
      ],
      [
        "--cache",
        (value) => {
          flags.cache = parseEnum(value, CACHE_DRIVERS, "cache");
        },
      ],
      [
        "--queue",
        (value) => {
          flags.queue = parseEnum(value, QUEUE_DRIVERS, "queue");
        },
      ],
      [
        "--mail",
        (value) => {
          flags.mail = parseEnum(value, MAIL_DRIVERS, "mail");
        },
      ],
      [
        "--spa-prefix",
        (value) => {
          flags.spaPrefix = value.startsWith("/") ? value : `/${value}`;
        },
      ],
    ];

    let matched = false;
    for (const [name, apply] of pairs) {
      const inline = takeValue(arg, name);
      if (inline !== undefined) {
        apply(inline);
        matched = true;
        break;
      }
      if (arg === name) {
        apply(argv[index + 1] ?? "");
        index += 1;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}. Pass --help to list flags.`);
    }
    positional.push(arg);
  }

  if (positional[0]) {
    flags.projectName = positional[0];
  }
  return flags;
}

function applyFlagOverrides(base: StarterLayers, flags: ParsedFlags): StarterLayers {
  return {
    ...base,
    kit: flags.kit ?? base.kit,
    frontend: flags.frontend ?? base.frontend,
    database: flags.database ?? base.database,
    auth: flags.auth ?? base.auth,
    tenancy: flags.tenancy ?? base.tenancy,
    cache: flags.cache ?? base.cache,
    queue: flags.queue ?? base.queue,
    mail: flags.mail ?? base.mail,
    spaPrefix: flags.spaPrefix ?? base.spaPrefix,
    extras: { ...base.extras, ...flags.extras },
  };
}

function layersFromFlags(flags: ParsedFlags): StarterLayers {
  const kit = flags.kit ?? "hobby";
  if (kit === "custom") {
    const base = presetLayers("hobby");
    base.kit = "custom";
    return applyFlagOverrides(base, flags);
  }
  return applyFlagOverrides(presetLayers(kit), flags);
}

export type { ParsedFlags };
export { applyFlagOverrides, KIT_ALIASES, layersFromFlags, parseCreateStrataArgs, parseKit, usage };
