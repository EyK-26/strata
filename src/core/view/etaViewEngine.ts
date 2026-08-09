import { join } from "node:path";
import { Eta } from "eta";
import type { ViewEngine } from "./viewEngine";

const DEFAULT_VIEWS_DIRECTORY = join(process.cwd(), "resources/views");
const DEFAULT_LAYOUT = "layouts/app.eta";

interface RenderOptions {
  layout?: string | false;
}

type LayoutDataResolver = () => Promise<Record<string, unknown>>;

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
  }

  async render(
    name: string,
    data: Record<string, unknown> = {},
    options: RenderOptions = {},
  ): Promise<string> {
    const template = name.endsWith(".eta") ? name : `${name}.eta`;
    const layoutData = this.resolveLayoutData ? await this.resolveLayoutData() : {};
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

export type { RenderOptions };
export { DEFAULT_LAYOUT, DEFAULT_VIEWS_DIRECTORY, EtaViewEngine };
