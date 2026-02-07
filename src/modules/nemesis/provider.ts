import type { ServiceProvider } from "../../bootstrap/contracts";
import NemesisRepository from "./repository";

const nemesisRepositoryToken = "nemesis.repository";

const nemesisProvider: ServiceProvider = {
  name: "nemesis.provider",
  register({ container, dependencies }) {
    container.singleton(nemesisRepositoryToken, () => new NemesisRepository());
    dependencies.nemesisRepository = container.resolve(nemesisRepositoryToken);
  },
};

export default nemesisProvider;
export { nemesisRepositoryToken };
