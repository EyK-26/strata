import { type AppModule } from "../../bootstrap/contracts";
import CharacterController from "./controller";
import characterProvider, {
  characterRepositoryToken,
  characterServiceToken,
} from "./provider";
import { createCharacterRoutes } from "./routes";

const characterModule: AppModule = {
  name: "character",
  providers: [characterProvider],
  routes({ dependencies, cachedJson }) {
    return createCharacterRoutes(dependencies, cachedJson);
  },
};

export default characterModule;
export { characterHasManyNemeses } from "./relationships";
export { characterProvider, characterRepositoryToken, characterServiceToken };
export { CharacterController };
export { parseCharacterIdParams, parseCharacterListQuery } from "./requests";
export type { CharacterIdParams, CharacterListQueryDto } from "./requests";
export {
  toCharacterResource,
  toCharacterResourceCollection,
  toCharacterTreeRecordResource,
  toJSONTreeResource,
} from "./resources";
export { createCharacterRoutes } from "./routes";
export { default as CharacterRepository } from "./repository";
export { default as CharacterService } from "./service";
export { characterTable } from "./table";
