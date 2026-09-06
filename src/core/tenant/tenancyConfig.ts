type TenancyDriver = "rls" | "column" | "none";

function readTenancyDriver(env: Record<string, string | undefined> = process.env): TenancyDriver {
  if (env.TENANCY_DRIVER === "none") {
    return "none";
  }
  if (env.TENANCY_DRIVER === "column") {
    return "column";
  }
  return "rls";
}

function isTenancyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return readTenancyDriver(env) !== "none";
}

/** Postgres `SET LOCAL` / `set_config` for row-level security. SQLite and MySQL cannot do this. */
function isRlsTenancy(env: Record<string, string | undefined> = process.env): boolean {
  return readTenancyDriver(env) === "rls";
}

export type { TenancyDriver };
export { isRlsTenancy, isTenancyEnabled, readTenancyDriver };
