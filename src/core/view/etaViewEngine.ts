import { join, relative } from "node:path";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { missingOptionalPeer } from "../runtime/optionalPeer.ts";
import { assertEtaHtmlSource } from "./assertEtaHtmlSource";
import type { ViewEngine } from "./viewEngine";

const DEFAULT_VIEWS_DIRECTORY = join(process.cwd(), "resources/views");
const DEFAULT_LAYOUT = "layouts/app.eta";

interface RenderOptions {
  layout?: string | false;
  request?: Request;
}

type LayoutDataResolver = (request?: Request) => Promise<Record<string, unknown>>;

type EtaEngine = {
  renderAsync(template: string, data: unknown): Promise<string> | string;
  readFile?: (path: string) => string;
};

/**
 * Renders `.eta` files as HTML + Eta tags (`<% %>`, `<%= %>`, `<%~ include() %>`).
 * Pug class/attribute shorthand is rejected at render time.
 */
class EtaViewEngine implements ViewEngine {
  private eta: EtaEngine | null = null;
  private etaPending: Promise<EtaEngine> | null = null;
  private readonly viewsDirectory: string;
  private readonly resolveLayoutData?: LayoutDataResolver;

  constructor(
    viewsDirectory: string = DEFAULT_VIEWS_DIRECTORY,
    resolveLayoutData?: LayoutDataResolver,
  ) {
    this.viewsDirectory = viewsDirectory;
    this.resolveLayoutData = resolveLayoutData;
  }

  private async getEta(): Promise<EtaEngine> {
    if (this.eta) {
      return this.eta;
    }
    if (!this.etaPending) {
      this.etaPending = this.createEta();
    }
    return this.etaPending;
  }

  private async createEta(): Promise<EtaEngine> {
    let eta: EtaEngine;
    try {
      const mod = await import("eta");
      eta = new mod.Eta({
        views: this.viewsDirectory,
        autoTrim: false,
      }) as unknown as EtaEngine;
    } catch (error) {
      this.etaPending = null;
      throw missingOptionalPeer("eta", "to render HTML views", error);
    }
    const readFile = eta.readFile?.bind(eta);
    eta.readFile = (path: string) => {
      const source = readFile ? readFile(path) : "";
      assertEtaHtmlSource(relative(this.viewsDirectory, path) || path, source);
      return source;
    };
    this.eta = eta;
    return eta;
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
    const eta = await this.getEta();
    const body = await eta.renderAsync(template, mergedData);
    const layout = options.layout ?? DEFAULT_LAYOUT;

    if (layout === false) {
      return body;
    }

    const layoutTemplate = layout.endsWith(".eta") ? layout : `${layout}.eta`;

    return await eta.renderAsync(layoutTemplate, {
      ...mergedData,
      body,
    });
  }
}

export type { LayoutDataResolver, RenderOptions };
export { DEFAULT_LAYOUT, DEFAULT_VIEWS_DIRECTORY, EtaViewEngine };
