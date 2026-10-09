import { stdin } from "node:process";

type InitialAdminInput = {
  email: string;
  name: string;
  password: string;
  tenantId?: number;
};

type InitialAdminOptions = {
  tenantRequired: boolean;
  provision: (input: InitialAdminInput) => Promise<void>;
  /** Trusted test/embedding input; never accept password arguments or environment defaults. */
  input?: AsyncIterable<Uint8Array>;
};

async function runInitialAdminCommand(args: string[], options: InitialAdminOptions): Promise<void> {
  const flags = new Map<string, string>();
  let passwordStdin = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--password-stdin" && !passwordStdin) {
      passwordStdin = true;
    } else if (flag === "--email" || flag === "--name" || flag === "--tenant") {
      const value = args[++index];
      if (!value || value.startsWith("--") || flags.has(flag)) {
        throw new Error("Initial-admin options must have one explicit value each.");
      }
      flags.set(flag, value);
    } else {
      throw new Error("Use --email, --name, --password-stdin and, for tenant apps, --tenant.");
    }
  }
  const email = (flags.get("--email") ?? "").trim().toLowerCase();
  const name = (flags.get("--name") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || /[\p{C}]/u.test(email)) {
    throw new Error("A valid initial-admin email is required.");
  }
  if (!name || name.length > 200 || /[\p{C}]/u.test(name)) {
    throw new Error("A nonempty initial-admin name without control characters is required.");
  }
  const tenantRaw = flags.get("--tenant");
  const tenantId = tenantRaw === undefined ? undefined : Number(tenantRaw);
  if (options.tenantRequired) {
    if (!tenantRaw || !/^[1-9]\d*$/.test(tenantRaw) || !Number.isSafeInteger(tenantId)) {
      throw new Error("An existing positive safe-integer tenant ID is required.");
    }
  } else if (tenantRaw !== undefined) {
    throw new Error("This application does not accept a tenant option.");
  }
  if (!passwordStdin || (!options.input && stdin.isTTY)) {
    throw new Error(
      "Provide --password-stdin through a pipe; interactive terminal input is refused.",
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Bcrypt accepts at most 72 UTF-8 bytes; allow a single terminal CRLF.
  for await (const chunk of options.input ?? stdin) {
    size += chunk.byteLength;
    if (size > 74) throw new Error("Initial-admin password exceeds the supported byte limit.");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let password: string;
  try {
    password = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes)
      .replace(/\r?\n$/, "");
  } catch {
    throw new Error("Initial-admin password must be valid UTF-8.");
  }
  if (
    [...password].length < 16 ||
    new TextEncoder().encode(password).byteLength > 72 ||
    /[\p{C}]/u.test(password) ||
    password === "StrataDemo!ChangeMe"
  ) {
    throw new Error(
      "Use a unique password of at least 16 characters and at most 72 UTF-8 bytes, without control characters or demo defaults.",
    );
  }
  try {
    await options.provision({ email, name, password, tenantId });
  } catch {
    // Drivers/observers can include bound values in errors. Never forward credential-bearing causes.
    throw new Error(
      "Initial-admin provisioning failed. Check schema, tenant, existing admins/accounts and the one-time claim; no account is promoted or overwritten.",
    );
  }
}

export type { InitialAdminInput, InitialAdminOptions };
export { runInitialAdminCommand };
