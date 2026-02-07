import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { NotFoundError } from "../../core/errors/http";
import {
  buildRequestCacheKey,
  jsonResponse,
  withErrorHandling,
} from "../../core/http";
import {
  parseCharacterIdParams,
  parseCharacterListQuery,
  type CharacterIdParams,
} from "./requests";
import {
  toCharacterResource,
  toCharacterResourceCollection,
} from "./resources";

class CharacterController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseCharacterListQuery(request);
    const cacheKey = buildRequestCacheKey("/characters", request);

    return await this.cachedJson(cacheKey, async () => {
      return toCharacterResourceCollection(
        await this.dependencies.characterRepository.findAll({
          limit: query.limit,
          ...(query.gender ? { where: { gender: query.gender } } : {}),
        }),
      );
    });
  });

  readonly show = withErrorHandling(
    async ({ params }: { params: CharacterIdParams }) => {
      const { id } = parseCharacterIdParams(params);
      const character =
        await this.dependencies.characterRepository.findByIdOrThrow(
          id,
          (characterId) =>
            new NotFoundError(`Character ${characterId} not found.`),
        );

      return jsonResponse(toCharacterResource(character));
    },
  );

  readonly formattedIndex = withErrorHandling(async () => {
    return await this.cachedJson("/characters-formatted", async () => {
      return toCharacterResourceCollection(
        await this.dependencies.characterService.getCharactersWithNemesisAndSecrets(),
      );
    });
  });
}

export default CharacterController;
