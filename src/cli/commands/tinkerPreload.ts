import { appDisplayName } from "@getstrata/core/runtime/appKeyPrefix";
import { assignTinkerGlobals, createTinkerContext } from "./tinker";

if (process.env.STRATA_TINKER !== "1") {
  const context = createTinkerContext();
  assignTinkerGlobals(context);
}

console.log(
  `${appDisplayName()} tinker. Globals: container, dependencies, repos, mailer(), storage()`,
);
