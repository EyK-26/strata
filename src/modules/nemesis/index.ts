import { type AppModule } from "../../bootstrap/contracts";
import NemesisController from "./controller";
import nemesisProvider from "./provider";
import { createNemesisRoutes } from "./routes";

const nemesisModule: AppModule = {
  name: "nemesis",
  providers: [nemesisProvider],
  routes({ dependencies, cachedJson }) {
    return createNemesisRoutes(dependencies, cachedJson);
  },
};

export default nemesisModule;
export {
  nemesisBelongsToCharacter,
  nemesisHasManySecrets,
} from "./relationships";
export { default as nemesisProvider, nemesisRepositoryToken } from "./provider";
export { NemesisController };
export {
  parseCharacterNemesisParams,
  parseNemesisIdParams,
  parseNemesisListQuery,
} from "./requests";
export type {
  CharacterNemesisParams,
  NemesisIdParams,
  NemesisListQueryDto,
} from "./requests";
export {
  toNemesisResource,
  toNemesisResourceCollection,
  toNemesisTreeRecordResource,
} from "./resources";
export { createNemesisRoutes } from "./routes";
export { default as NemesisRepository } from "./repository";
export { nemesisTable } from "./table";
