import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { appDisplayName } from "@getstrata/core/runtime/appKeyPrefix";
import { assignTinkerGlobals, createTinkerContext } from "./tinker";

if (process.env.STRATA_TINKER !== "1") {
  const context = await createTinkerContext();
  assignTinkerGlobals(context);
  const lifecycle = new LifecycleCoordinator();
  lifecycle.register("tinker.application", context.stop, "stop");
  const uninstall = installGracefulShutdownSignals(undefined, lifecycle);
  process.once("beforeExit", () => {
    uninstall();
    void context.stop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}

console.log(
  `${appDisplayName()} tinker. Globals: application, invoke, container, dependencies, mailer(), storage()`,
);
