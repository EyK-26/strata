/**
 * M1 DESIGN FIXTURE ONLY. These declarations have no runtime implementation and
 * are not package exports. Do not import them into an application.
 */
import type { ModuleRouteContext } from "@getstrata/bootstrap/contracts";
import type { ViewRenderer } from "@getstrata/core/view/viewRenderer";
import type { BunRequest, Serve, Server } from "bun";

export type GuardedHandler<Path extends string, Data> = Serve.Handler<
  BunRequest<Path>,
  Server<Data>,
  Response
>;

type Responder<Path extends string, Data> = Response | GuardedHandler<Path, Data>;

// At least one native HTTP method; an empty object must not look like a route.
type Methods<Path extends string, Data> = {
  [Method in Serve.HTTPMethod]: Readonly<Record<Method, Responder<Path, Data>>> &
    Readonly<Partial<Record<Exclude<Serve.HTTPMethod, Method>, Responder<Path, Data>>>>;
}[Serve.HTTPMethod];

export type GuardedRoute<Path extends string, Data> = Responder<Path, Data> | Methods<Path, Data>;

export declare function defineApplicationRoutes<Data = unknown>(): <
  const Paths extends `/${string}`,
>(
  routes: { readonly [Path in Paths]: GuardedRoute<Path, Data> },
) => { readonly [Path in Paths]: GuardedRoute<Path, Data> };

// Reuse concrete existing owners. Renderer availability does not authorize routes.
type SharedHttpContext = Pick<ModuleRouteContext, "dependencies" | "cachedJson" | "kernel">;
export type DocumentRenderer = Pick<ViewRenderer, "render" | "renderHtmx">;
export type ApiRouteContext = SharedHttpContext & { readonly documents?: DocumentRenderer };
export type WebRouteContext = SharedHttpContext & { readonly documents: DocumentRenderer };

// Same illustrative manifest contract as the earlier M1 public-origin sketch.
export interface PublicArtifactEntry {
  readonly relativePath: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly integrity: `sha256-${string}`;
}
export interface PublicArtifactManifest {
  readonly format: 1;
  readonly buildId: string;
  readonly artifacts: Readonly<Record<string, PublicArtifactEntry>>;
}
export interface PublicArtifactPolicy {
  readonly origin: string;
  readonly releasePrefix: string;
}
export interface PublicArtifactResolver {
  resolve(logicalName: string): Readonly<{
    url: string;
    mediaType: string;
    bytes: number;
    integrity: `sha256-${string}`;
  }>;
}
export declare function createPublicArtifactResolver(
  manifest: unknown,
  policy: PublicArtifactPolicy,
): PublicArtifactResolver;
