// Retired ambient ownership APIs must not survive in package declarations.
// @ts-expect-error Bootstrap cannot publish the old registry either.
import { resolveApplicationAuth } from "@getstrata/bootstrap/applicationRegistry";
// @ts-expect-error Use an explicit application or execution scope.
import { setActiveApplicationContext } from "@getstrata/core";
// @ts-expect-error Facades no longer select a process-wide application.
import { cache } from "@getstrata/core/facades";
// @ts-expect-error The global registry subpath is retired.
import { resolveApplicationCache } from "@getstrata/core/runtime/applicationRegistry";

void [setActiveApplicationContext, cache, resolveApplicationCache, resolveApplicationAuth];
