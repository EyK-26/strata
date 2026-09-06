import { defaultLayers } from "./presets.ts";
import {
  AUTH_STACKS,
  type AuthStack,
  CACHE_DRIVERS,
  type CacheLayer,
  DATABASES,
  type DatabaseLayer,
  DOCKER_SERVICE_NAMES,
  type DockerServiceName,
  dockerLayerForNeeded,
  enableDockerServices,
  FRONTENDS,
  type FrontendMode,
  MAIL_DRIVERS,
  type MailLayer,
  neededDockerServices,
  QUEUE_DRIVERS,
  type QueueLayer,
  reconcileDocker,
  type StarterLayers,
  TENANCY_DRIVERS,
  type TenancyLayer,
} from "./types.ts";

interface ParsedFlags {
  help: boolean;
  yes: boolean;
  noInteractive: boolean;
  force: boolean;
  extrasPrompt: boolean;
  projectName?: string;
  frontend?: FrontendMode;
  database?: DatabaseLayer;
  auth?: AuthStack;
  tenancy?: TenancyLayer;
  cache?: CacheLayer;
  queue?: QueueLayer;
  mail?: MailLayer;
  spaPrefix?: string;
  extras: Partial<StarterLayers["extras"]>;
  docker?: boolean;
  dockerServices?: DockerServiceName[];
}

function usage(): string {
  return `Usage: create-strata [project-name] [options]

Scaffold a runnable Strata app. The wizard always asks each layer. For CI, pass --yes
and the layer flags you want (defaults are SQLite, JSON API, header auth).

Options:
  --frontend          api | server-htmx | spa-react | hybrid
  --database          sqlite | postgres | mysql (one database; not mixed)
  --auth              headers | cookie | token | jwt | cookie-token | cookie-token-jwt
  --tenancy           none | column | rls (rls is Postgres SET LOCAL; sqlite/mysql coerce rls to column)
  --cache             array | redis
  --queue             sync | redis
  --mail              log | smtp
  --spa-prefix        SPA URL prefix (default /app)
  --mfa / --no-mfa
  --email-verification / --no-email-verification
  --scim / --no-scim
  --metrics / --no-metrics
  --extras            Prompt (or enable) MFA, email verification, SCIM, metrics
  --docker            Write Docker Compose for every selected tool that needs a service
  --no-docker         Skip docker-compose.yml; use installs already on this machine
  --docker-services   Subset: postgres, mysql, redis, mailpit (comma-separated)
  --force             Replace an existing directory
  --yes, --no-interactive
  -h, --help

Examples:
  bunx create-strata my-app
  bunx create-strata my-app --yes
  bunx create-strata html --frontend server-htmx --database postgres --auth cookie --cache redis --queue redis --docker --yes
  bunx create-strata html --frontend server-htmx --database postgres --no-docker --yes
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

function parseDockerServiceList(raw: string): DockerServiceName[] {
  const names = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  const unknown = names.filter(
    (name) => !(DOCKER_SERVICE_NAMES as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown docker service "${unknown.join(", ")}". Expected ${DOCKER_SERVICE_NAMES.join(", ")}.`,
    );
  }
  return names as DockerServiceName[];
}

function dockerFlagsProvided(flags: ParsedFlags): boolean {
  return flags.docker !== undefined || flags.dockerServices !== undefined;
}

function parseCreateStrataArgs(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = {
    help: false,
    yes: false,
    noInteractive: false,
    force: false,
    extrasPrompt: false,
    extras: {},
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
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
    if (arg === "--force") {
      flags.force = true;
      continue;
    }
    if (arg === "--extras" || arg === "--corporate") {
      flags.extrasPrompt = true;
      continue;
    }
    if (arg === "--docker") {
      flags.docker = true;
      flags.dockerServices = undefined;
      continue;
    }
    if (arg === "--no-docker") {
      flags.docker = false;
      flags.dockerServices = undefined;
      continue;
    }

    const dockerServicesInline = takeValue(arg, "--docker-services");
    if (dockerServicesInline !== undefined) {
      flags.docker = true;
      flags.dockerServices = parseDockerServiceList(dockerServicesInline);
      continue;
    }
    if (arg === "--docker-services") {
      flags.docker = true;
      flags.dockerServices = parseDockerServiceList(argv[index + 1] ?? "");
      index += 1;
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
    ];
    const boolMatch = boolFlags.find(([name]) => name === arg);
    if (boolMatch) {
      flags.extras[boolMatch[1]] = boolMatch[2];
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

function applyDockerFlags(layers: StarterLayers, flags: ParsedFlags): StarterLayers {
  const needed = neededDockerServices(layers);

  if (flags.docker === false) {
    return {
      ...layers,
      docker: dockerLayerForNeeded(layers, false),
    };
  }

  if (flags.dockerServices) {
    const selected = flags.dockerServices.filter((name) => needed.includes(name));
    return {
      ...layers,
      docker: {
        enabled: selected.length > 0,
        services: enableDockerServices(selected),
      },
    };
  }

  if (flags.docker === true) {
    return {
      ...layers,
      docker: dockerLayerForNeeded(layers, true),
    };
  }

  return layers;
}

function applyFlagOverrides(base: StarterLayers, flags: ParsedFlags): StarterLayers {
  const next: StarterLayers = {
    ...base,
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
  if (next.database !== "postgres" && next.tenancy === "rls") {
    next.tenancy = "column";
  }
  return reconcileDocker(applyDockerFlags(next, flags));
}

function layersFromFlags(flags: ParsedFlags): StarterLayers {
  return applyFlagOverrides(defaultLayers(), flags);
}

export type { ParsedFlags };
export {
  applyFlagOverrides,
  dockerFlagsProvided,
  layersFromFlags,
  parseCreateStrataArgs,
  parseDockerServiceList,
  usage,
};
