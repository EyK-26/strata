import { expect, test } from "bun:test";
import { type InitialAdminInput, runInitialAdminCommand } from "@getstrata/cli/initialAdmin";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import {
  renderInitialAdminCommand,
  renderInitialAdminMigration,
} from "../../../packages/strata-starter/src/renderInitialAdmin.ts";
import { renderCliRegisterTs } from "../../../packages/strata-starter/src/renderRuntime.ts";

const args = [
  "--email",
  " Operator@Example.test ",
  "--name",
  "Initial Operator",
  "--password-stdin",
];
const secret = "unique-private-bootstrap-secret";
async function* input(value = secret) {
  yield new TextEncoder().encode(value);
}

test("initial admin input normalizes identity, preserves secret whitespace, and supports one final CRLF", async () => {
  let result: InitialAdminInput | undefined;
  await runInitialAdminCommand(args, {
    tenantRequired: false,
    input: input(` ${secret} \r\n`),
    provision: async (value) => {
      result = value;
    },
  });
  expect(result).toEqual({
    email: "operator@example.test",
    name: "Initial Operator",
    password: ` ${secret} `,
    tenantId: undefined,
  });
});

test("invalid options and secrets fail before any provisioning callback", async () => {
  let calls = 0;
  for (const [flags, value, tenantRequired] of [
    [[...args, "--password", secret], secret, false],
    [[...args, "--email", "other@example.test"], secret, false],
    [args.slice(0, -1), secret, false],
    [args, "StrataDemo!ChangeMe", false],
    [args, "short", false],
    [args, `${secret}\nsecond-line`, false],
    [args, "é".repeat(37), false],
    [args, secret, true],
    [[...args, "--tenant", "1e2"], secret, true],
    [[...args, "--tenant", "9007199254740992"], secret, true],
    [[...args, "--tenant", "1"], secret, false],
    [["--email", "invalid", "--name", "Name", "--password-stdin"], secret, false],
  ] as const) {
    await expect(
      runInitialAdminCommand([...flags], {
        tenantRequired,
        input: input(value),
        provision: async () => {
          calls++;
        },
      }),
    ).rejects.toBeInstanceOf(Error);
  }
  expect(calls).toBe(0);
});

test("oversized or malformed UTF-8 input is bounded and rejected", async () => {
  let calls = 0;
  async function* huge() {
    yield new Uint8Array(75);
    throw new Error("must not keep reading");
  }
  async function* invalid() {
    yield new Uint8Array([0xff]);
  }
  for (const stream of [huge(), invalid()]) {
    await expect(
      runInitialAdminCommand(args, {
        tenantRequired: false,
        input: stream,
        provision: async () => {
          calls++;
        },
      }),
    ).rejects.toBeInstanceOf(Error);
  }
  expect(calls).toBe(0);
});

test("tenant selection is explicit and credential-bearing provider errors are redacted", async () => {
  await expect(
    runInitialAdminCommand([...args, "--tenant", "12"], {
      tenantRequired: true,
      input: input(),
      provision: async (value) => {
        expect(value.tenantId).toBe(12);
        throw new Error(`SQL driver included ${secret}`);
      },
    }),
  ).rejects.toThrow("Initial-admin provisioning failed.");
  try {
    await runInitialAdminCommand(args, {
      tenantRequired: false,
      input: input(),
      provision: async () => {
        throw new Error(secret);
      },
    });
  } catch (error) {
    expect(String(error)).not.toContain(secret);
    expect((error as Error).cause).toBeUndefined();
  }
});

test("only user-auth starters generate the explicit admin command and claim migration", () => {
  for (const auth of ["headers", "cookie", "token", "jwt", "cookie-token-jwt"]) {
    const layers = layersFromFlags(parseCreateStrataArgs(["admin-test", "--auth", auth, "--yes"]));
    const generated = renderInitialAdminCommand(layers);
    if (auth === "headers") {
      expect(generated).toBeNull();
      expect(renderInitialAdminMigration(layers)).toBeNull();
      expect(renderCliRegisterTs(layers)).not.toContain("auth:provision-admin");
    } else {
      expect(generated).toContain("hashPassword(input.password)");
      expect(generated).not.toContain("seed()");
      expect(renderCliRegisterTs(layers)).toContain("auth:provision-admin");
      expect(renderInitialAdminMigration(layers)).toContain('table.integer("id").primary()');
    }
  }
});
