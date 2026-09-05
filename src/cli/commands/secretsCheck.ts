import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";

function secretsCheckCommand(): void {
  const env = {
    ...process.env,
    APP_ENV: "production",
  };
  assertProductionSecrets(env);

  console.log("Production secret checks passed for the current environment.");
}

export { secretsCheckCommand };
