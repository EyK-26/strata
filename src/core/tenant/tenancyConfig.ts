type TenancyDriver = "rls" | "none";

function readTenancyDriver(env: Record<string, string | undefined> = process.env): TenancyDriver {
  return env.TENANCY_DRIVER === "none" ? "none" : "rls";
}

function isTenancyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return readTenancyDriver(env) !== "none";
}

export type { TenancyDriver };
export { isTenancyEnabled, readTenancyDriver };
