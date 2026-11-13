/** Compiled contracts; not executed. */

import type { AuthReader } from "@getstrata/core/auth/authReader";
import type { AuthGuard, AuthOutcome } from "@getstrata/core/auth/guard";
export function authOutcomeContracts(guard: AuthGuard, reader: AuthReader, request: Request) {
  const outcome: AuthOutcome | Promise<AuthOutcome> = guard.authenticate(request);
  const established: Promise<AuthOutcome> = reader.authenticate(request);
  const falsyError: AuthOutcome = {
    status: "error",
    user: null,
    credentialSource: "bearer",
    error: undefined,
  };
  void [outcome, established, falsyError];
  // @ts-expect-error A guard must expose the authoritative outcome contract.
  const oldGuard: AuthGuard = { resolve: () => null };
  // @ts-expect-error Absence cannot establish a principal.
  const malformed: AuthOutcome = { status: "absent", user: { id: 1 }, credentialSource: null };
  // @ts-expect-error Invalid credentials cannot grant a principal.
  const invalid: AuthOutcome = { status: "invalid", user: { id: 1 }, credentialSource: "bearer" };
  void [oldGuard, malformed, invalid];
}
