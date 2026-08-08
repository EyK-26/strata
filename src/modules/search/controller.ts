import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "../../core/http";
import { searchServiceToken } from "./provider";
import type SearchService from "./service";

class SearchController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): SearchService {
    return resolveService(this.dependencies, searchServiceToken);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = new URL(request?.url ?? "http://local/search").searchParams.get("q")?.trim();

    if (!query) {
      return jsonResponse({ data: [] });
    }

    const results = await this.service.search(query);
    return jsonResponse({ data: results });
  });
}

export default SearchController;
