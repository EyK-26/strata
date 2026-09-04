import type { AppModule } from "@getstrata/bootstrap/contracts";

const catalogModule: AppModule = {
  name: "catalog",
  order: 5,
  routes() {
    return {};
  },
};

export default catalogModule;
