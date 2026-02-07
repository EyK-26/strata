import { type AppModule } from "../../bootstrap/contracts";
import SecretController from "./controller";
import secretProvider from "./provider";
import { createSecretRoutes } from "./routes";

const secretModule: AppModule = {
  name: "secret",
  providers: [secretProvider],
  routes({ dependencies, cachedJson }) {
    return createSecretRoutes(dependencies, cachedJson);
  },
};

export default secretModule;
export { secretBelongsToNemesis } from "./relationships";
export { default as secretProvider, secretRepositoryToken } from "./provider";
export { SecretController };
export {
  parseNemesisSecretParams,
  parseSecretIdParams,
  parseSecretListQuery,
} from "./requests";
export type {
  NemesisSecretParams,
  SecretIdParams,
  SecretListQueryDto,
} from "./requests";
export { toSecretResource, toSecretResourceCollection } from "./resources";
export { createSecretRoutes } from "./routes";
export { default as SecretRepository } from "./repository";
export { secretTable } from "./table";
