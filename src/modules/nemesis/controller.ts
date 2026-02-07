import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { NotFoundError } from "../../core/errors/http";
import {
  buildRequestCacheKey,
  jsonResponse,
  withErrorHandling,
} from "../../core/http";
import {
  parseCharacterNemesisParams,
  parseNemesisIdParams,
  parseNemesisListQuery,
  type CharacterNemesisParams,
  type NemesisIdParams,
} from "./requests";
import { toNemesisResource, toNemesisResourceCollection } from "./resources";

class NemesisController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseNemesisListQuery(request);
    const cacheKey = buildRequestCacheKey("/nemesis", request);

    return await this.cachedJson(cacheKey, async () => {
      return toNemesisResourceCollection(
        await this.dependencies.nemesisRepository.findAll({
          limit: query.limit,
          ...(query.isAlive === undefined
            ? {}
            : { where: { is_alive: query.isAlive } }),
        }),
      );
    });
  });

  readonly show = withErrorHandling(
    async ({ params }: { params: NemesisIdParams }) => {
      const { id } = parseNemesisIdParams(params);
      const nemesis = await this.dependencies.nemesisRepository.findByIdOrThrow(
        id,
        (nemesisId) => new NotFoundError(`Nemesis ${nemesisId} not found.`),
      );

      return jsonResponse(toNemesisResource(nemesis));
    },
  );

  readonly byCharacter = withErrorHandling(
    async ({ params }: { params: CharacterNemesisParams }) => {
      const { id } = parseCharacterNemesisParams(params);
      return jsonResponse(
        toNemesisResourceCollection(
          await this.dependencies.nemesisRepository.findByCharacterId(id),
        ),
      );
    },
  );
}

export default NemesisController;
