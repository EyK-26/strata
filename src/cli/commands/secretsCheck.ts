import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { assertWorkHubProductionSecrets } from "../../config/productionSecrets";

function secretsCheckCommand(): void {
  const env = {
    ...process.env,
    APP_ENV: "production",
  };
  assertProductionSecrets(env);
  assertWorkHubProductionSecrets(env);

  console.log("Production secret checks passed for the current environment.");
}

export { secretsCheckCommand };
