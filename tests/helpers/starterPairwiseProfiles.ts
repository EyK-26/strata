/** Planning inventory only: these compiler-valid profiles have not run generated apps. */
import { compileStarterFeatures } from "../../packages/strata-starter/src/featurePlan";
import {
  AUTH_STACKS,
  CACHE_DRIVERS,
  DATABASES,
  DOCKER_SERVICE_NAMES,
  FRONTENDS,
  MAIL_DRIVERS,
  QUEUE_DRIVERS,
  type StarterLayers,
  TENANCY_DRIVERS,
} from "../../packages/strata-starter/src/types";

type Value = string | boolean;
type Selection = Readonly<Record<string, Value>>;
export type Dimension = Readonly<{ key: string; values: readonly Value[] }>;
const extras = [
  "mfa",
  "emailVerification",
  "scim",
  "metrics",
  "oauthGithub",
  "oidc",
  "billing",
  "webhooks",
] as const;
export const starterPairwiseDimensions: readonly Dimension[] = Object.freeze(
  [
    { key: "frontend", values: FRONTENDS },
    { key: "database", values: DATABASES },
    { key: "auth", values: AUTH_STACKS },
    { key: "tenancy", values: TENANCY_DRIVERS },
    { key: "cache", values: CACHE_DRIVERS },
    { key: "queue", values: QUEUE_DRIVERS },
    { key: "mail", values: MAIL_DRIVERS },
    ...extras.map((key) => ({ key: `extras.${key}`, values: [false, true] })),
    { key: "docker.enabled", values: [false, true] },
    ...DOCKER_SERVICE_NAMES.map((key) => ({
      key: `docker.services.${key}`,
      values: [false, true],
    })),
  ].map((dimension) =>
    Object.freeze({ ...dimension, values: Object.freeze([...dimension.values]) }),
  ),
);

export type Assignment = Readonly<{ dimension: string; value: Value }>;
export type Pair = readonly [Assignment, Assignment];
export type InventoryProfile = Readonly<{
  name: string;
  source: "risk-seed" | "pairwise";
  layers: StarterLayers;
}>;
export type UnsupportedPair = Readonly<{ pair: Pair; reasons: readonly string[] }>;
export type StarterPairwiseInventory = Readonly<{
  kind: "compiler-valid-planning-inventory";
  profiles: readonly InventoryProfile[];
  dimensions: readonly Dimension[];
  feasiblePairs: number;
  coveredPairs: number;
  unsupportedPairs: readonly UnsupportedPair[];
  totalPairs: number;
  spaPrefixBoundaryRepresentatives: readonly string[];
}>;

function layers(selection: Selection, spaPrefix = "/app"): StarterLayers {
  return {
    frontend: selection.frontend as StarterLayers["frontend"],
    database: selection.database as StarterLayers["database"],
    auth: selection.auth as StarterLayers["auth"],
    tenancy: selection.tenancy as StarterLayers["tenancy"],
    cache: selection.cache as StarterLayers["cache"],
    queue: selection.queue as StarterLayers["queue"],
    mail: selection.mail as StarterLayers["mail"],
    spaPrefix,
    extras: Object.fromEntries(
      extras.map((key) => [key, selection[`extras.${key}`]]),
    ) as unknown as StarterLayers["extras"],
    docker: {
      enabled: selection["docker.enabled"] as boolean,
      services: Object.fromEntries(
        DOCKER_SERVICE_NAMES.map((key) => [key, selection[`docker.services.${key}`]]),
      ) as StarterLayers["docker"]["services"],
    },
  };
}
export function starterPairKey(pair: Pair): string {
  return JSON.stringify(pair.map(({ dimension, value }) => [dimension, value]));
}
function pairsFor(input: Selection): Pair[] {
  const pairs: Pair[] = [];
  for (let left = 0; left < starterPairwiseDimensions.length; left++) {
    for (let right = left + 1; right < starterPairwiseDimensions.length; right++) {
      const a = starterPairwiseDimensions[left];
      const b = starterPairwiseDimensions[right];
      if (!a || !b) throw new Error("Missing inventory dimension.");
      pairs.push([
        { dimension: a.key, value: input[a.key] as Value },
        { dimension: b.key, value: input[b.key] as Value },
      ]);
    }
  }
  return pairs;
}
function valid(input: Selection): boolean {
  try {
    compileStarterFeatures(layers(input));
    return true;
  } catch {
    return false;
  }
}

const defaults: Selection = Object.freeze(
  Object.fromEntries(starterPairwiseDimensions.map(({ key, values }) => [key, values[0] as Value])),
);

/** Explicit security/adapter intersections retained even when pairwise coverage could omit them. */
export const starterHighRiskSeeds = Object.freeze([
  {
    name: "postgres-rls-cookie-all-extras",
    overrides: {
      database: "postgres",
      tenancy: "rls",
      auth: "cookie",
      cache: "redis",
      queue: "redis",
      mail: "smtp",
      "docker.enabled": true,
      ...Object.fromEntries(extras.map((key) => [`extras.${key}`, true])),
      ...Object.fromEntries(DOCKER_SERVICE_NAMES.map((key) => [`docker.services.${key}`, true])),
    },
  },
  {
    name: "postgres-rls-api-token-local",
    overrides: { database: "postgres", tenancy: "rls", frontend: "api", auth: "token" },
  },
  {
    name: "mysql-hybrid-combined-redis-smtp",
    overrides: {
      database: "mysql",
      tenancy: "column",
      frontend: "hybrid",
      auth: "cookie-token-jwt",
      cache: "redis",
      queue: "redis",
      mail: "smtp",
      "extras.mfa": true,
      "extras.billing": true,
      "extras.webhooks": true,
      "docker.enabled": true,
      "docker.services.mysql": true,
      "docker.services.redis": true,
      "docker.services.mailpit": true,
      "docker.services.adminer": true,
    },
  },
  {
    name: "sqlite-cookie-column-no-docker",
    overrides: {
      database: "sqlite",
      tenancy: "column",
      frontend: "server-htmx",
      auth: "cookie",
      "extras.mfa": true,
      "extras.oauthGithub": true,
      "extras.oidc": true,
    },
  },
] as const);

/**
 * Current compiler constraints are controlled by database/auth selectors. For each
 * fixed pair, enumerate at most 3x6 selector completions with other toggles off.
 * Compiler rejection is authoritative; no full Cartesian profile set is built.
 */
function completions(fixed: Selection): { candidates: Record<string, Value>[]; reasons: string[] } {
  const candidates: Record<string, Value>[] = [];
  const reasons = new Set<string>();
  for (const database of fixed.database === undefined ? DATABASES : [fixed.database]) {
    for (const auth of fixed.auth === undefined ? AUTH_STACKS : [fixed.auth]) {
      const candidate = { ...defaults, ...fixed, database, auth };
      try {
        compileStarterFeatures(layers(candidate));
        candidates.push(candidate);
      } catch (error) {
        reasons.add(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { candidates, reasons: [...reasons].sort() };
}

export function createStarterPairwiseInventory(): StarterPairwiseInventory {
  const feasible = new Map<string, Pair>();
  const unsupported: UnsupportedPair[] = [];
  let totalPairs = 0;
  for (let left = 0; left < starterPairwiseDimensions.length; left++) {
    for (let right = left + 1; right < starterPairwiseDimensions.length; right++) {
      const a = starterPairwiseDimensions[left];
      const b = starterPairwiseDimensions[right];
      if (!a || !b) throw new Error("Missing inventory dimension.");
      for (const av of a.values)
        for (const bv of b.values) {
          const pair: Pair = [
            { dimension: a.key, value: av },
            { dimension: b.key, value: bv },
          ];
          totalPairs++;
          const completed = completions({ [a.key]: av, [b.key]: bv });
          if (completed.candidates.length) feasible.set(starterPairKey(pair), pair);
          else unsupported.push({ pair, reasons: completed.reasons });
        }
    }
  }
  const uncovered = new Set(feasible.keys());
  const profiles: InventoryProfile[] = [];
  const cover = (chosen: Selection, name: string, source: InventoryProfile["source"]) => {
    compileStarterFeatures(layers(chosen));
    profiles.push({ name, source, layers: layers(chosen) });
    for (const pair of pairsFor(chosen)) uncovered.delete(starterPairKey(pair));
  };
  for (const seed of starterHighRiskSeeds)
    cover({ ...defaults, ...seed.overrides }, seed.name, "risk-seed");
  const score = (candidate: Selection) =>
    pairsFor(candidate).reduce(
      (count, pair) => count + Number(uncovered.has(starterPairKey(pair))),
      0,
    );
  while (uncovered.size) {
    const key = uncovered.values().next().value;
    const pair = key === undefined ? undefined : feasible.get(key);
    if (!pair) throw new Error("Missing uncovered pair.");
    const fixed = Object.fromEntries(pair.map(({ dimension, value }) => [dimension, value]));
    const candidates = completions(fixed).candidates;
    let best: Selection | undefined;
    let bestScore = -1;
    for (const candidate of candidates) {
      for (const dimension of starterPairwiseDimensions) {
        if (
          Object.hasOwn(fixed, dimension.key) ||
          dimension.key === "database" ||
          dimension.key === "auth"
        )
          continue;
        let chosen = candidate[dimension.key] as Value;
        let chosenScore = score(candidate);
        for (const value of dimension.values) {
          const option = { ...candidate, [dimension.key]: value };
          if (!valid(option)) continue;
          const nextScore = score(option);
          if (nextScore > chosenScore) {
            chosen = value;
            chosenScore = nextScore;
          }
        }
        candidate[dimension.key] = chosen;
      }
      const candidateScore = score(candidate);
      if (candidateScore > bestScore) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
    if (!best || bestScore <= 0) throw new Error("Pairwise inventory failed to make progress.");
    cover(
      best,
      `pairwise-${String(profiles.length - starterHighRiskSeeds.length + 1).padStart(3, "0")}`,
      "pairwise",
    );
  }
  const prefixes = ["/app", "/console", "/workspace/app"];
  for (const spaPrefix of prefixes) compileStarterFeatures(layers(defaults, spaPrefix));
  return {
    kind: "compiler-valid-planning-inventory",
    profiles,
    dimensions: starterPairwiseDimensions,
    feasiblePairs: feasible.size,
    coveredPairs: feasible.size - uncovered.size,
    unsupportedPairs: unsupported,
    totalPairs,
    spaPrefixBoundaryRepresentatives: prefixes,
  };
}
