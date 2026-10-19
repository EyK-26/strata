import { validateSpaPrefix } from "@getstrata/core/runtime/frontendMode";

// The generated scripts supply only this public value before Bun starts.
export const SPA_PREFIX = validateSpaPrefix(process.env.BUN_PUBLIC_SPA_PREFIX);

// Public schema capability selected by the generator, not an authorization decision.
export const TENANCY_ENABLED = false;
