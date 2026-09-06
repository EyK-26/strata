type TenancyDriver = "rls" | "column" | "none";

const TENANCY_DRIVERS: readonly TenancyDriver[] = ["rls", "column", "none"];

/** Unset means rls (the Postgres example). Anything else must be an exact driver name. */
function readTenancyDriver(env: Record<string, string | undefined> = process.env): TenancyDriver {
  const raw = env.TENANCY_DRIVER?.trim();
  if (raw === undefined || raw === "") {
    return "rls";
  }
  if ((TENANCY_DRIVERS as readonly string[]).includes(raw)) {
    return raw as TenancyDriver;
  }
  throw new Error(
    `TENANCY_DRIVER must be one of ${TENANCY_DRIVERS.join(", ")}; received "${raw}".`,
  );
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
