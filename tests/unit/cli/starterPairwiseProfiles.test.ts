import { describe, expect, test } from "bun:test";
import { compileStarterFeatures } from "../../../packages/strata-starter/src/featurePlan";
import type { StarterLayers } from "../../../packages/strata-starter/src/types";
import { createStarterPairwiseInventory } from "../../helpers/starterPairwiseProfiles";

// Deliberately independent of the generator's dimension list and completion logic.
const axes: Record<string, readonly (string | boolean)[]> = {
  frontend: ["api", "server-htmx", "spa-react", "hybrid"],
  database: ["sqlite", "postgres", "mysql"],
  auth: ["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"],
  tenancy: ["none", "column", "rls"],
  cache: ["array", "redis"],
  queue: ["sync", "redis"],
  mail: ["log", "smtp"],
  "extras.mfa": [false, true],
  "extras.emailVerification": [false, true],
  "extras.scim": [false, true],
  "extras.metrics": [false, true],
  "extras.oauthGithub": [false, true],
  "extras.oidc": [false, true],
  "extras.billing": [false, true],
  "extras.webhooks": [false, true],
  "docker.enabled": [false, true],
  "docker.services.postgres": [false, true],
  "docker.services.mysql": [false, true],
  "docker.services.redis": [false, true],
  "docker.services.mailpit": [false, true],
  "docker.services.adminer": [false, true],
};
type Value = string | boolean;
const entries = Object.entries(axes);
const key = (a: string, av: Value, b: string, bv: Value) =>
  JSON.stringify([
    [a, av],
    [b, bv],
  ]);
function valueAt(layers: StarterLayers, path: string): Value {
  let value: unknown = layers;
  for (const part of path.split(".")) value = (value as Record<string, unknown>)[part];
  if (typeof value !== "string" && typeof value !== "boolean")
    throw new Error(`Invalid profile ${path}`);
  return value;
}
function unsupportedPair(a: string, av: Value, b: string, bv: Value): boolean {
  const chosen: Record<string, Value> = { [a]: av, [b]: bv };
  if (chosen.tenancy === "rls" && chosen.database !== undefined && chosen.database !== "postgres")
    return true;
  const auth = chosen.auth;
  if (auth === undefined) return false;
  const cookie = ["cookie", "cookie-token", "cookie-token-jwt"].includes(String(auth));
  if (
    !cookie &&
    ["extras.mfa", "extras.oauthGithub", "extras.oidc"].some((extra) => chosen[extra] === true)
  )
    return true;
  return (
    auth === "headers" &&
    ["extras.emailVerification", "extras.scim"].some((extra) => chosen[extra] === true)
  );
}

const inventory = createStarterPairwiseInventory();
describe("starter constrained pairwise planning inventory", () => {
  test("contains every declared starter axis/toggle and every supported value-pair", () => {
    expect(
      Object.fromEntries(inventory.dimensions.map(({ key, values }) => [key, values])),
    ).toEqual(axes);
    const covered = new Set<string>();
    for (const profile of inventory.profiles) {
      expect(() => compileStarterFeatures(profile.layers)).not.toThrow();
      for (let left = 0; left < entries.length; left++)
        for (let right = left + 1; right < entries.length; right++) {
          const [a] = entries[left] as [string, readonly Value[]];
          const [b] = entries[right] as [string, readonly Value[]];
          covered.add(key(a, valueAt(profile.layers, a), b, valueAt(profile.layers, b)));
        }
    }
    const feasible = new Set<string>();
    const impossible = new Set<string>();
    for (let left = 0; left < entries.length; left++)
      for (let right = left + 1; right < entries.length; right++) {
        const [a, avs] = entries[left] as [string, readonly Value[]];
        const [b, bvs] = entries[right] as [string, readonly Value[]];
        for (const av of avs)
          for (const bv of bvs) {
            (unsupportedPair(a, av, b, bv) ? impossible : feasible).add(key(a, av, b, bv));
          }
      }
    expect(covered).toEqual(feasible);
    expect(
      new Set(
        inventory.unsupportedPairs.map(({ pair }) =>
          key(pair[0].dimension, pair[0].value, pair[1].dimension, pair[1].value),
        ),
      ),
    ).toEqual(impossible);
    expect({
      total: inventory.totalPairs,
      feasible: inventory.feasiblePairs,
      covered: inventory.coveredPairs,
      impossible: impossible.size,
    }).toEqual({ total: 1181, feasible: 1168, covered: 1168, impossible: 13 });
    for (const [axis, values] of entries)
      expect(new Set(inventory.profiles.map(({ layers }) => valueAt(layers, axis)))).toEqual(
        new Set(values),
      );
  });

  test("impossible pair examples reject in the actual compiler and carry explanations", () => {
    const base = inventory.profiles.find(
      ({ name }) => name === "postgres-rls-api-token-local",
    )?.layers;
    if (!base) throw new Error("Missing explicit token seed.");
    for (const { pair, reasons } of inventory.unsupportedPairs) {
      const invalid = structuredClone(base);
      invalid.tenancy = "none";
      invalid.auth = "headers";
      for (const extra of Object.keys(invalid.extras) as (keyof typeof invalid.extras)[])
        invalid.extras[extra] = false;
      for (const { dimension, value } of pair) {
        const path = dimension.split(".");
        let target = invalid as unknown as Record<string, unknown>;
        for (const part of path.slice(0, -1)) target = target[part] as Record<string, unknown>;
        const final = path.at(-1);
        if (!final) throw new Error("Invalid pair path.");
        target[final] = value;
      }
      expect(reasons.length).toBeGreaterThan(0);
      expect(() => compileStarterFeatures(invalid)).toThrow(/Invalid starter feature plan:/);
    }
  });

  test("retains explicit high-risk seeds and deterministic case count/digest", () => {
    expect(
      inventory.profiles.filter(({ source }) => source === "risk-seed").map(({ name }) => name),
    ).toEqual([
      "postgres-rls-cookie-all-extras",
      "postgres-rls-api-token-local",
      "mysql-hybrid-combined-redis-smtp",
      "sqlite-cookie-column-no-docker",
    ]);
    expect(inventory.profiles).toHaveLength(25);
    expect(
      new Bun.CryptoHasher("sha256").update(JSON.stringify(inventory.profiles)).digest("hex"),
    ).toBe("58cfa55f057c91eb0d758d9663f94ad719e2351d69efe5965afa8473f9f4a4a6");
    expect(createStarterPairwiseInventory()).toEqual(inventory);
    expect(inventory.spaPrefixBoundaryRepresentatives).toEqual([
      "/app",
      "/console",
      "/workspace/app",
    ]);
    expect(inventory.kind).toBe("compiler-valid-planning-inventory");
  });
});
