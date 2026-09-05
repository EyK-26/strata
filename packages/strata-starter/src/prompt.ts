import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ParsedFlags } from "./parseArgs.ts";
import { applyFlagOverrides, layersFromFlags } from "./parseArgs.ts";
import { presetLayers } from "./presets.ts";
import type { KitId, StarterLayers } from "./types.ts";

interface Prompter {
  question(message: string, defaultValue?: string): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select<T extends string>(
    message: string,
    choices: Array<{ value: T; label: string }>,
    defaultValue: T,
  ): Promise<T>;
  close(): void;
}

function isInteractive(flags: ParsedFlags): boolean {
  if (flags.yes || flags.noInteractive) {
    return false;
  }
  return Boolean(input.isTTY && output.isTTY);
}

function createReadlinePrompter(): Prompter {
  const rl = createInterface({ input, output });

  return {
    async question(message, defaultValue) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = (await rl.question(`${message}${suffix}: `)).trim();
      return answer || defaultValue || "";
    },
    async confirm(message, defaultValue = false) {
      const hint = defaultValue ? "Y/n" : "y/N";
      const answer = (await rl.question(`${message} (${hint}): `)).trim().toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      return answer === "y" || answer === "yes";
    },
    async select(message, choices, defaultValue) {
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
    close() {
      rl.close();
    },
  };
}

async function promptLayers(flags: ParsedFlags, prompter: Prompter): Promise<StarterLayers> {
  const kit = await prompter.select<KitId>(
    "Starter kit",
    [
      { value: "hobby", label: "hobby: SQLite API, header auth" },
      { value: "team", label: "team: Postgres HTML, cookie sessions, Redis" },
      {
        value: "enterprise",
        label: "enterprise: hybrid UI, cookies + tokens + JWT, RLS, SMTP",
      },
      { value: "hiroapp-hobby", label: "hiroapp-hobby: hiring-shaped, SQLite, /apply" },
      { value: "hiroapp-team", label: "hiroapp-team: hiring-shaped, Postgres, /apply" },
      {
        value: "hiroapp-enterprise",
        label: "hiroapp-enterprise: hiring-shaped staff HTML + candidate SPA",
      },
      { value: "custom", label: "custom: pick each layer" },
    ],
    flags.kit ?? "hobby",
  );

  const isCustom = kit === "custom";
  let layers: StarterLayers = isCustom
    ? { ...presetLayers("hobby"), kit: "custom" }
    : presetLayers(kit);
  layers = applyFlagOverrides(layers, { ...flags, kit });

  const customize = isCustom || (await prompter.confirm("Customize layers?", false));

  if (customize) {
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
      "Database",
      [
        { value: "sqlite", label: "sqlite: file, no Docker" },
        { value: "postgres", label: "postgres: production default" },
        { value: "mysql", label: "mysql: published mirror or primary" },
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
      [
        { value: "none", label: "none: no tenant table" },
        { value: "rls", label: "rls: Postgres row-level security (you add tenant tables)" },
      ],
      layers.tenancy,
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
    if (layers.frontend === "spa-react" || layers.frontend === "hybrid") {
      layers.spaPrefix = await prompter.question("SPA prefix", layers.spaPrefix);
    }
  }

  const askExtras =
    flags.corporate ||
    layers.scale === "enterprise" ||
    kit === "enterprise" ||
    kit === "hiroapp-enterprise" ||
    (await prompter.confirm("Configure corporate extras?", false));

  if (askExtras) {
    layers.extras.mfa = await prompter.confirm("Staff MFA env flag?", layers.extras.mfa);
    layers.extras.emailVerification = await prompter.confirm(
      "Email verification env flag?",
      layers.extras.emailVerification,
    );
    layers.extras.scim = await prompter.confirm("SCIM env stubs?", layers.extras.scim);
    layers.extras.metrics = await prompter.confirm("Metrics token?", layers.extras.metrics);
    layers.extras.sqliteKiosk = await prompter.confirm(
      "SQLite kiosk named connection?",
      layers.extras.sqliteKiosk,
    );
    layers.extras.mysqlMirror = await prompter.confirm(
      "MySQL job-board mirror connection?",
      layers.extras.mysqlMirror,
    );
  }

  return applyFlagOverrides(layers, flags);
}

async function resolveStarterPlan(
  flags: ParsedFlags,
  injected?: Prompter,
): Promise<{ projectName: string; layers: StarterLayers }> {
  if (!isInteractive(flags)) {
    if (flags.kit === "custom") {
      const hasLayerFlag = Boolean(
        flags.frontend ||
          flags.database ||
          flags.auth ||
          flags.tenancy ||
          flags.cache ||
          flags.queue ||
          flags.mail,
      );
      if (!hasLayerFlag) {
        throw new Error(
          "custom kit requires layer flags (--frontend, --database, --auth, ...) or a terminal.",
        );
      }
    }
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

export type { Prompter };
export { createReadlinePrompter, isInteractive, promptLayers, resolveStarterPlan };
