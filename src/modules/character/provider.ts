import {
  getRequiredDependency,
  type ServiceProvider,
} from "../../bootstrap/contracts";
import CharacterRepository from "./repository";
import CharacterService from "./service";

const characterRepositoryToken = "character.repository";
const characterServiceToken = "character.service";

const characterProvider: ServiceProvider = {
  name: "character.provider",
  register({ container, dependencies }) {
    container.singleton(
      characterRepositoryToken,
      () => new CharacterRepository(),
    );
    dependencies.characterRepository = container.resolve(
      characterRepositoryToken,
    );
  },
  boot({ container, dependencies }) {
    container.singleton(
      characterServiceToken,
      () =>
        new CharacterService(
          getRequiredDependency(dependencies, "characterRepository"),
          getRequiredDependency(dependencies, "nemesisRepository"),
          getRequiredDependency(dependencies, "secretRepository"),
        ),
    );

    dependencies.characterService = container.resolve(characterServiceToken);
  },
};

export default characterProvider;
export { characterRepositoryToken, characterServiceToken };
