import type { ServiceProvider } from "../../bootstrap/contracts";
import SecretRepository from "./repository";

const secretRepositoryToken = "secret.repository";

const secretProvider: ServiceProvider = {
  name: "secret.provider",
  register({ container, dependencies }) {
    container.singleton(secretRepositoryToken, () => new SecretRepository());
    dependencies.secretRepository = container.resolve(secretRepositoryToken);
  },
};

export default secretProvider;
export { secretRepositoryToken };
