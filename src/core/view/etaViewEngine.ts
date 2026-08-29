import { join, relative } from "node:path";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { Eta } from "eta";
import { assertEtaHtmlSource } from "./assertEtaHtmlSource";
import type { ViewEngine } from "./viewEngine";

const DEFAULT_VIEWS_DIRECTORY = join(process.cwd(), "resources/views");
const DEFAULT_LAYOUT = "layouts/app.eta";

interface RenderOptions {
  layout?: string | false;
  request?: Request;
}

type LayoutDataResolver = (request?: Request) => Promise<Record<string, unknown>>;

/**
 * Renders `.eta` files as HTML + Eta tags (`<% %>`, `<%= %>`, `<%~ include() %>`).
 * Pug class/attribute shorthand is rejected at render time.
 */
class EtaViewEngine implements ViewEngine {
  private readonly eta: Eta;
  private readonly resolveLayoutData?: LayoutDataResolver;

  constructor(
    viewsDirectory: string = DEFAULT_VIEWS_DIRECTORY,
    resolveLayoutData?: LayoutDataResolver,
  ) {
    this.eta = new Eta({
      views: viewsDirectory,
      autoTrim: false,
    });
    this.resolveLayoutData = resolveLayoutData;

    const readFile = this.eta.readFile?.bind(this.eta);
    this.eta.readFile = (path: string) => {
      const source = readFile ? readFile(path) : "";
      assertEtaHtmlSource(relative(viewsDirectory, path) || path, source);
      return source;
    };
  }

  async render(
    name: string,
    data: Record<string, unknown> = {},
    options: RenderOptions = {},
  ): Promise<string> {
    const template = name.endsWith(".eta") ? name : `${name}.eta`;
    const request = options.request ?? currentRequestMeta().request;
    const layoutData = this.resolveLayoutData ? await this.resolveLayoutData(request) : {};
    const mergedData = { ...layoutData, ...data };
    const body = await this.eta.renderAsync(template, mergedData);
    const layout = options.layout ?? DEFAULT_LAYOUT;

    if (layout === false) {
      return body;
    }

    const layoutTemplate = layout.endsWith(".eta") ? layout : `${layout}.eta`;

    return await this.eta.renderAsync(layoutTemplate, {
      ...mergedData,
      body,
    });
  }
}

export type { LayoutDataResolver, RenderOptions };
export { DEFAULT_LAYOUT, DEFAULT_VIEWS_DIRECTORY, EtaViewEngine };
