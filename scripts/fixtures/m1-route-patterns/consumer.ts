/** Isolated real-socket consumer; imports resolve inside the exact-published generated app. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import type { BunRequest, Serve, Server } from "bun";
import type { Declaration, ProbeCase, ProbeRequest, Transport } from "./types.ts";

const input = process.argv[2];
const mode = process.argv[3] as Transport;
const output = process.argv[4];
assert.ok(input && output);
assert.ok(mode === "native" || mode === "framework");
const probe: ProbeCase = await Bun.file(input).json();
const calls: { owner: string; method: string; pathname: string; params: object }[] = [];
const admissions: { method: string; routeTemplate?: string }[] = [];
type Callback = (request: BunRequest, server: Server<unknown>) => Response;
type MethodMap = Partial<Record<Serve.HTTPMethod, Callback | Response>>;
type RouteValue = Callback | Response | MethodMap;
const routes: Record<string, RouteValue> = {};
function callback(owner: string, status = 200): Callback {
  return (request) => {
    const event = {
      owner,
      method: request.method,
      pathname: new URL(request.url).pathname,
      params: { ...request.params },
      copiedParams: routeParams(request),
    };
    calls.push(event);
    return Response.json(event, { status, headers: { "x-probe-owner": owner } });
  };
}
function value(declaration: Declaration): RouteValue {
  if (declaration.methods) {
    const methods: Record<string, Callback> = {};
    for (const method of declaration.methods)
      methods[method.method] = callback(method.owner, method.status);
    return methods;
  }
  return declaration.kind === "response"
    ? new Response(declaration.owner, {
        status: 201,
        headers: { "x-probe-owner": declaration.owner },
      })
    : callback(declaration.owner);
}
for (const declaration of probe.declarations) routes[declaration.path] = value(declaration);

function exchange(port: number, spec: ProbeRequest, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    owner: string | null;
    body: string;
    csrfCookie?: string;
    requestId: boolean;
    allow?: string;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        // A raw Node HTTP path avoids fetch/URL dot-segment and backslash normalization.
        path: spec.target,
        method: spec.method ?? "GET",
        agent: false,
        headers: {
          connection: "close",
          ...headers,
          ...(spec.deny ? { "x-probe-deny": "yes" } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) response.destroy(new Error("Probe response exceeded its bound."));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            owner:
              typeof response.headers["x-probe-owner"] === "string"
                ? response.headers["x-probe-owner"]
                : null,
            body: Buffer.concat(chunks).toString(),
            csrfCookie: response.headers["set-cookie"]?.[0]?.split(";")[0],
            requestId: typeof response.headers["x-request-id"] === "string",
            allow: response.headers.allow,
          }),
        );
      },
    );
    request.on("error", reject);
    request.setTimeout(5000, () => request.destroy(new Error("Raw HTTP probe timed out.")));
    request.end();
  });
}
let server: Server<unknown> | undefined;
let context: InitializedAppContext | undefined;
let closeDatabase: (() => Promise<void>) | undefined;
let failure: unknown;
const report: Record<string, unknown> = {
  name: probe.name,
  mode,
  classification: probe.classification,
  sourceDeclarations: probe.declarations,
  requests: [],
  calls,
  admissions,
};
try {
  let selectedRoutes = routes;
  if (probe.family === "collector") {
    assert.equal(mode, "framework");
    const application: {
      createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
    } = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
    const database: { closeDatabase(): Promise<void> } = await import(
      new URL("../bootstrap/database.ts", import.meta.url).href
    );
    closeDatabase = database.closeDatabase;
    context = (await application.createApp({ migrate: false })).context;
    const modules: AppModule[] = probe.declarations.map((declaration) => ({
      name: declaration.owner,
      routes: () => ({ [declaration.path]: value(declaration) }),
      openApi: {
        [declaration.path]: Object.fromEntries(
          (declaration.methods ?? [{ method: "GET", owner: declaration.owner }]).map((method) => [
            method.method.toUpperCase(),
            { summary: method.owner },
          ]),
        ),
      },
    }));
    if (probe.collector === "spread") {
      modules.splice(0, modules.length, { name: "precomposed", routes: () => routes });
    }
    if (probe.collector === "orphan") {
      buildModuleRoutes(context.dependencies, {
        modules: [{ name: "previous", routes: () => ({ "/previous": callback("previous") }) }],
      });
      report.registryBeforeFailure = routeRegistry.list();
      modules.push({
        name: "orphan",
        routes: () => ({}),
        openApi: { "/missing": { GET: { summary: "orphan" } } },
      });
    }
    try {
      selectedRoutes = buildModuleRoutes(context.dependencies, {
        apiPrefix: "/contracts/",
        modules,
      });
      if (probe.collector === "repeat")
        buildModuleRoutes(context.dependencies, {
          apiPrefix: "/contracts/",
          modules,
          clearRegistry: false,
        });
      const registry = routeRegistry.list();
      report.registry = registry;
      if (probe.classification === "contract-control") {
        const owner =
          probe.collector === "replace" || probe.collector === "insertion"
            ? "second"
            : probe.collector === "alias"
              ? "current"
              : undefined;
        assert.deepEqual(
          registry,
          [
            {
              method: probe.collector === "replace" ? "POST" : "GET",
              path: "/contracts/shared",
              middleware: ["global", "api"],
              ...(owner ? { openApi: { summary: owner } } : {}),
            },
          ],
          "The actual winning handler and OpenAPI owner must remain paired.",
        );
      }
      report.collectedPaths = Object.keys(selectedRoutes);
      report.collectedMethods = Object.fromEntries(
        Object.entries(selectedRoutes).map(([path, entry]) => [
          path,
          typeof entry === "function" ? ["GET"] : Object.keys(entry),
        ]),
      );
      selectedRoutes = { ...selectedRoutes, "/probe-csrf": callback("csrf") };
    } catch (error) {
      if (probe.collector !== "orphan") throw error;
      assert.ok(error instanceof Error && error.message.includes("no API route"));
      report.registryAfterFailure = routeRegistry.list();
      report.startup = { outcome: "collector-rejected", error: error.message };
      assert.equal(calls.length, 0);
    }
  }
  if (!report.startup) {
    const fallback = () =>
      new Response("fallback", { status: 404, headers: { "x-probe-owner": "fallback" } });
    try {
      server =
        mode === "native"
          ? Bun.serve({ hostname: "127.0.0.1", port: 0, routes: selectedRoutes, fetch: fallback })
          : createWebServer({
              port: 0,
              native: { hostname: "127.0.0.1" },
              routes: selectedRoutes,
              handle: fallback,
              onRequest(request) {
                admissions.push({
                  method: request.method,
                  routeTemplate: currentRequestMeta().routeTemplate,
                });
                if (request.headers.has("x-probe-deny"))
                  return new Response("denied", {
                    status: 403,
                    headers: { "x-probe-owner": "admission" },
                  });
              },
            });
      report.startup = {
        outcome: "started",
        callbacksBeforeListen: calls.length,
        admissionsBeforeListen: admissions.length,
      };
      assert.equal(calls.length, 0, "Startup must not execute fixture business handlers.");
      assert.equal(admissions.length, 0);
    } catch (error) {
      if (probe.classification === "contract-control") throw error;
      report.startup = {
        outcome: "transport-startup-rejected",
        factory: mode === "native" ? "Bun.serve" : "createWebServer",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (server) {
      const activeServer = server;
      const exchanges: Record<string, unknown>[] = [];
      report.requests = exchanges;
      let csrfHeaders: Record<string, string> = {};
      if (probe.family === "collector") {
        assert.ok(context);
        // Use the framework's real API CSRF issuer through a module-owned GET.
        const issuer = buildModuleRoutes(context.dependencies, {
          modules: [
            {
              name: "csrf-issuer",
              routes: () => ({ "/issue": callback("issuer") }),
            },
          ],
          clearRegistry: false,
        });
        const issuerServer = createWebServer({
          port: 0,
          native: { hostname: "127.0.0.1" },
          routes: issuer,
        });
        try {
          assert.ok(issuerServer.port);
          const issued = await exchange(issuerServer.port, { target: "/issue" });
          assert.ok(issued.csrfCookie);
          const cookie = issued.csrfCookie;
          csrfHeaders = {
            cookie,
            "x-csrf-token": decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)),
            origin: activeServer.url.origin,
          };
        } finally {
          await issuerServer.stop(true);
        }
      }
      for (const request of probe.requests) {
        const beforeCalls = calls.length;
        const beforeAdmissions = admissions.length;
        assert.ok(activeServer.port);
        const observed = await exchange(activeServer.port, request, csrfHeaders);
        const { csrfCookie: _cookie, ...safe } = observed;
        exchanges.push({
          request,
          observed: safe,
          callbacks: calls.slice(beforeCalls),
          admissions: admissions.slice(beforeAdmissions),
        });
        const expectedOwner =
          mode === "framework" && request.deny ? "admission" : request.expectedOwner;
        if (expectedOwner !== undefined)
          assert.equal(
            observed.owner,
            expectedOwner,
            `${probe.name}: ${request.method ?? "GET"} ${request.target}`,
          );
        const expectedStatus = mode === "framework" && request.deny ? 403 : request.expectedStatus;
        if (expectedStatus !== undefined) assert.equal(observed.status, expectedStatus);
        if (request.expectedEmptyBody) assert.equal(observed.body, "");
        if ((request.method ?? "GET") === "HEAD") assert.equal(observed.body, "");
        if (mode === "framework")
          assert.equal(
            admissions.length - beforeAdmissions,
            1,
            "Each request has one admission callback.",
          );
        if (mode === "framework" && request.deny)
          assert.equal(
            calls.length,
            beforeCalls,
            "Admission must deny before the business handler.",
          );
      }
    }
  }
} catch (error) {
  failure = error;
} finally {
  const errors: unknown[] = [];
  for (const close of [
    () => server?.stop(true),
    () => context?.dispose(),
    () => closeDatabase?.(),
  ]) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...errors],
      "Original and cleanup errors retained.",
    );
  report.status = failure ? "FAILED" : "COMPLETE";
  report.cleanup = {
    listenerCreated: !!server,
    contextCreated: !!context,
    listenerStopped: errors.length === 0,
    contextDisposed: true,
    databaseClosed: true,
    errors: errors.map((error) => (error instanceof Error ? error.message : String(error))),
  };
  if (failure) report.error = failure instanceof Error ? failure.stack : String(failure);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
if (failure) throw failure;
