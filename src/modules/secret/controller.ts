import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { NotFoundError } from "../../core/errors/http";
import {
  buildRequestCacheKey,
  jsonResponse,
  withErrorHandling,
} from "../../core/http";
import {
  parseNemesisSecretParams,
  parseSecretIdParams,
  parseSecretListQuery,
  type NemesisSecretParams,
  type SecretIdParams,
} from "./requests";
import { toSecretResource, toSecretResourceCollection } from "./resources";

class SecretController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseSecretListQuery(request);
    const cacheKey = buildRequestCacheKey("/secrets", request);

    return await this.cachedJson(cacheKey, async () => {
      return toSecretResourceCollection(
        await this.dependencies.secretRepository.findAll({
          limit: query.limit,
        }),
      );
    });
  });

  readonly show = withErrorHandling(
    async ({ params }: { params: SecretIdParams }) => {
      const { id } = parseSecretIdParams(params);
      const secret = await this.dependencies.secretRepository.findByIdOrThrow(
        id,
        (secretId) => new NotFoundError(`Secret ${secretId} not found.`),
      );

      return jsonResponse(toSecretResource(secret));
    },
  );

  readonly byNemesis = withErrorHandling(
    async ({ params }: { params: NemesisSecretParams }) => {
      const { id } = parseNemesisSecretParams(params);
      return jsonResponse(
        toSecretResourceCollection(
          await this.dependencies.secretRepository.findByNemesisId(id),
        ),
      );
    },
  );
}

export default SecretController;
