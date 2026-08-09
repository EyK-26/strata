export type HttpMethod = "GET" | "POST";

export type RouteHandler = (
  request: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

interface Route {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: RouteHandler) {
    this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler) {
    this.add("POST", path, handler);
  }

  private add(method: HttpMethod, path: string, handler: RouteHandler) {
    const paramNames: string[] = [];
    const patternSource = path
      .replace(/\//g, "\\/")
      .replace(/:([a-zA-Z_]+)/g, (_, name: string) => {
        paramNames.push(name);
        return "([^/]+)";
      });
    this.routes.push({
      method,
      pattern: new RegExp(`^${patternSource}$`),
      paramNames,
      handler,
    });
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? "");
      });
      return await route.handler(request, params);
    }

    return null;
  }
}
