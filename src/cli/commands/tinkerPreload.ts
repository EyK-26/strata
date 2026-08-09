import { assignTinkerGlobals, createTinkerContext } from "./tinker";

if (process.env.WORKHUB_TINKER !== "1") {
  const context = createTinkerContext();
  assignTinkerGlobals(context);
}

console.log("WorkHub tinker — globals: container, dependencies, repos, mailer(), storage()");
