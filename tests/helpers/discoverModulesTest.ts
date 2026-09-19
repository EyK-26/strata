import { join } from "node:path";
import {
  configureModulesDirectory,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";

const emptyModulesDirectory = join(import.meta.dir, "../fixtures/empty-modules");

function resetDiscoverModulesForUnitTests(): void {
  resetDiscoverModulesForTests();
  configureModulesDirectory(emptyModulesDirectory);
}

export { emptyModulesDirectory, resetDiscoverModulesForUnitTests };
