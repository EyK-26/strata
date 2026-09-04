import { importHiroappModule, readDogfoodApp } from "./dogfoodApp.ts";
import "./preloadModules.ts";

if (readDogfoodApp() === "hiroapp") {
  await importHiroappModule("src/bootstrap/server.ts");
} else {
  const { default: App } = await import("./app");
  new App().serve();
}
