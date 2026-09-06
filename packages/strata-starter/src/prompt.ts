import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  applyFlagOverrides,
  dockerFlagsProvided,
  layersFromFlags,
  type ParsedFlags,
} from "./parseArgs.ts";
import { defaultLayers } from "./presets.ts";
import { promptConfirm, promptMultiSelect, promptSelect } from "./selectPrompt.ts";
import {
  DOCKER_SERVICE_LABELS,
  dockerLayerForNeeded,
  emptyDockerServices,
  extraApplies,
  neededDockerServices,
  type StarterLayers,
} from "./types.ts";

interface Prompter {
  question(message: string, defaultValue?: string): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select<T extends string>(
    message: string,
    choices: Array<{ value: T; label: string }>,
    defaultValue: T,
  ): Promise<T>;
  multiSelect<T extends string>(
    message: string,
    choices: Array<{ value: T; label: string; enabled: boolean }>,
  ): Promise<T[]>;
  close(): void;
}

const EXTRA_CHOICES = [
  { value: "mfa", label: "mfa: authenticator challenge + setup pages" },
  { value: "emailVerification", label: "email-verification: signed links + /email/verify" },
  { value: "scim", label: "scim: /Users adapter" },
  { value: "metrics", label: "metrics: Prometheus token" },
] as const;

type ExtraKey = (typeof EXTRA_CHOICES)[number]["value"];

function isInteractive(flags: ParsedFlags): boolean {
  if (flags.yes || flags.noInteractive) {
    return false;
  }
  return Boolean(input.isTTY && output.isTTY);
}

function canUseRawKeys(): boolean {
  return Boolean(input.isTTY && typeof input.setRawMode === "function");
}

function createReadlinePrompter(): Prompter {
  const rl = createInterface({ input, output });
  const io = { input, output };

  return {
    async question(message, defaultValue) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = (await rl.question(`${message}${suffix}: `)).trim();
      return answer || defaultValue || "";
    },
    async confirm(message, defaultValue = false) {
      if (canUseRawKeys()) {
        rl.pause();
        try {
          return await promptConfirm(message, defaultValue, io);
        } finally {
          input.setRawMode?.(false);
          rl.resume();
        }
      }
      const hint = defaultValue ? "Y/n" : "y/N";
      const answer = (await rl.question(`${message} (${hint}): `)).trim().toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      return answer === "y" || answer === "yes";
    },
    async select(message, choices, defaultValue) {
      if (canUseRawKeys()) {
        rl.pause();
        try {
          return await promptSelect(message, choices, defaultValue, io);
        } finally {
          input.setRawMode?.(false);
          rl.resume();
        }
      }
      console.log(message);
      for (const [index, choice] of choices.entries()) {
        const marker = choice.value === defaultValue ? "*" : " ";
        console.log(`  ${index + 1}) ${marker} ${choice.label}`);
      }
      const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue) + 1;
      const answer = (await rl.question(`Choose [${defaultIndex}]: `)).trim();
      if (!answer) {
        return defaultValue;
      }
      const asNumber = Number.parseInt(answer, 10);
      if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
        const selected = choices[asNumber - 1];
        return selected?.value ?? defaultValue;
      }
      const match = choices.find((choice) => choice.value === answer || choice.label === answer);
      return match?.value ?? defaultValue;
    },
    async multiSelect(message, choices) {
      if (canUseRawKeys()) {
        rl.pause();
        try {
          return await promptMultiSelect(message, choices, io);
        } finally {
          input.setRawMode?.(false);
          rl.resume();
        }
      }
      const enabled = new Set(
        choices.filter((choice) => choice.enabled).map((choice) => choice.value),
      );
      console.log(`${message} (yes/no each)`);
      for (const choice of choices) {
        const hint = enabled.has(choice.value) ? "Y/n" : "y/N";
        const answer = (await rl.question(`  ${choice.label} (${hint}): `)).trim().toLowerCase();
        if (!answer) {
          continue;
        }
        if (answer === "y" || answer === "yes") {
          enabled.add(choice.value);
        } else if (answer === "n" || answer === "no") {
          enabled.delete(choice.value);
        }
      }
      return [...enabled];
    },
    close() {
      rl.close();
    },
  };
}

function extrasStillToAsk(
  layers: StarterLayers,
  flags: ParsedFlags,
): Array<(typeof EXTRA_CHOICES)[number]> {
  return EXTRA_CHOICES.filter((choice) => {
    if (flags.extras[choice.value] !== undefined) {
      return false;
    }
    return extraApplies(choice.value, layers.auth);
  });
}

async function promptExtras(
  prompter: Prompter,
  extras: StarterLayers["extras"],
  layers: StarterLayers,
  flags: ParsedFlags,
): Promise<StarterLayers["extras"]> {
  const choices = extrasStillToAsk(layers, flags);
  if (choices.length === 0) {
    return extras;
  }

  const picked = new Set(
    await prompter.multiSelect(
      "Extras",
      choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        enabled: extras[choice.value],
      })),
    ),
  );
  const next = { ...extras };
  for (const choice of choices) {
    next[choice.value] = picked.has(choice.value);
  }
  for (const choice of EXTRA_CHOICES) {
    if (!extraApplies(choice.value, layers.auth) && flags.extras[choice.value] === undefined) {
      next[choice.value] = false;
    }
  }
  return next;
}

async function promptLayers(flags: ParsedFlags, prompter: Prompter): Promise<StarterLayers> {
  const layers: StarterLayers = applyFlagOverrides(defaultLayers(), flags);

  layers.frontend = await prompter.select(
    "Frontend",
    [
      { value: "api", label: "api: JSON only" },
      { value: "server-htmx", label: "server-htmx: Eta HTML + HTMX" },
      { value: "spa-react", label: "spa-react: JSON + React under SPA_PREFIX" },
      { value: "hybrid", label: "hybrid: HTML at / plus SPA prefix" },
    ],
    layers.frontend,
  );
  layers.database = await prompter.select(
    "Database (one engine)",
    [
      { value: "sqlite", label: "sqlite: file database" },
      { value: "postgres", label: "postgres" },
      { value: "mysql", label: "mysql" },
    ],
    layers.database,
  );
  layers.auth = await prompter.select(
    "Auth",
    [
      { value: "headers", label: "headers: x-authenticated-user-id (local/tests)" },
      { value: "cookie", label: "cookie: sessions table + CSRF" },
      { value: "token", label: "token: opaque hashed Bearer" },
      { value: "jwt", label: "jwt: short-lived HS256" },
      { value: "cookie-token", label: "cookie-token: HTML cookies + API tokens" },
      { value: "cookie-token-jwt", label: "cookie-token-jwt: cookies, tokens, and JWT" },
    ],
    layers.auth,
  );
  layers.tenancy = await prompter.select(
    "Tenancy",
    layers.database === "postgres"
      ? [
          { value: "none", label: "none: no tenant table" },
          {
            value: "column",
            label: "column: tenant table + users.tenant_id (no Postgres SET LOCAL)",
          },
          { value: "rls", label: "rls: Postgres row-level security plus a tenant table" },
        ]
      : [
          { value: "none", label: "none: no tenant table" },
          {
            value: "column",
            label: "column: tenant table + users.tenant_id (SQLite/MySQL cannot run Postgres RLS)",
          },
        ],
    layers.database === "postgres"
      ? layers.tenancy
      : layers.tenancy === "rls"
        ? "column"
        : layers.tenancy,
  );
  layers.cache = await prompter.select(
    "Cache",
    [
      { value: "array", label: "array: in-process" },
      { value: "redis", label: "redis" },
    ],
    layers.cache,
  );
  layers.queue = await prompter.select(
    "Queue",
    [
      { value: "sync", label: "sync: run jobs inline" },
      { value: "redis", label: "redis: background worker" },
    ],
    layers.queue,
  );
  layers.mail = await prompter.select(
    "Mail",
    [
      { value: "log", label: "log: print messages" },
      { value: "smtp", label: "smtp" },
    ],
    layers.mail,
  );
  if (
    flags.spaPrefix === undefined &&
    (layers.frontend === "spa-react" || layers.frontend === "hybrid")
  ) {
    layers.spaPrefix = await prompter.question("SPA prefix", layers.spaPrefix);
  }

  layers.extras = await promptExtras(prompter, layers.extras, layers, flags);

  if (!dockerFlagsProvided(flags)) {
    layers.docker = await promptDockerLayer(prompter, layers);
  }

  return applyFlagOverrides(layers, flags);
}

async function promptDockerLayer(
  prompter: Prompter,
  layers: StarterLayers,
): Promise<StarterLayers["docker"]> {
  const needed = neededDockerServices(layers);
  if (needed.length === 0) {
    return dockerLayerForNeeded(layers, false);
  }

  const labels = needed.map((name) => DOCKER_SERVICE_LABELS[name]).join(", ");
  const mode = await prompter.select(
    `How should supporting tools run (${labels})?`,
    [
      { value: "local", label: "local: installs already on this machine" },
      { value: "docker", label: "docker: Compose for all of them" },
      { value: "mix", label: "mix: pick Docker Compose vs local per tool" },
    ],
    "docker",
  );

  if (mode === "local") {
    return dockerLayerForNeeded(layers, false);
  }

  if (mode === "docker") {
    return dockerLayerForNeeded(layers, true);
  }

  const services = emptyDockerServices();
  for (const name of needed) {
    services[name] = await prompter.confirm(
      `Docker Compose for ${DOCKER_SERVICE_LABELS[name]}?`,
      true,
    );
  }
  const selected = needed.filter((name) => services[name]);
  return {
    enabled: selected.length > 0,
    services,
  };
}

async function resolveStarterPlan(
  flags: ParsedFlags,
  injected?: Prompter,
): Promise<{ projectName: string; layers: StarterLayers }> {
  if (!isInteractive(flags)) {
    return {
      projectName: flags.projectName ?? "strata-app",
      layers: layersFromFlags(flags),
    };
  }

  const prompter = injected ?? createReadlinePrompter();
  try {
    const projectName =
      flags.projectName || (await prompter.question("Project name", "strata-app")) || "strata-app";
    const layers = await promptLayers({ ...flags, projectName }, prompter);
    return { projectName, layers };
  } finally {
    if (!injected) {
      prompter.close();
    }
  }
}

export type { ExtraKey, Prompter };
export { createReadlinePrompter, EXTRA_CHOICES, isInteractive, promptLayers, resolveStarterPlan };
