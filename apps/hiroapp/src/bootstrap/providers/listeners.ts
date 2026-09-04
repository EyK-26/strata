import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { Application } from "../../models/Application.ts";
import { applicationObserver } from "../../observers/ApplicationObserver.ts";

const listenersProvider: ServiceProvider = {
  name: "hiroapp.listeners",
  boot() {
    Application.observe(applicationObserver);
    void import("../../listeners/sendApplicationSubmitted.ts");
    void import("../../schedule.ts");
  },
};

export { listenersProvider };
