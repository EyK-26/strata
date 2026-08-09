import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http";
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
