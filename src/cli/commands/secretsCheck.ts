import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";

function secretsCheckCommand(): void {
  assertProductionSecrets({
    ...process.env,
    APP_ENV: "production",
  });

  console.log("Production secret checks passed for the current environment.");
}

export { secretsCheckCommand };
