import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { isRlsTenancy } from "./tenancyConfig";

async function runWithMigrationBypass<T>(callback: () => T | Promise<T>): Promise<T> {
  if (!isRlsTenancy()) {
    return await callback();
  }

  await db`SELECT set_config('app.bypass_rls', 'true', false)`;

  try {
    return await callback();
  } finally {
    await db`SELECT set_config('app.bypass_rls', 'false', false)`;
  }
}

export { runWithMigrationBypass };
