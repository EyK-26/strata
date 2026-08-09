import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createReadlinePrompter } from "../../../packages/strata-starter/src/prompt.ts";
import {
  consumeSelectKeys,
  hasRawMode,
  moveSelectIndex,
  PromptCancelledError,
  promptConfirm,
  promptMultiSelect,
  promptSelect,
  resolveSelectIo,
} from "../../../packages/strata-starter/src/selectPrompt.ts";

const frontend = [
  { value: "api", label: "api: JSON only" },
  { value: "server-htmx", label: "server-htmx: Eta HTML + HTMX" },
  { value: "spa-react", label: "spa-react: JSON + React under SPA_PREFIX" },
] as const;

async function withKeys<T>(
  run: (input: PassThrough, output: PassThrough) => Promise<T>,
  keys: string[],
) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const pending = run(input, output);
  await Promise.resolve();
  for (const key of keys) {
    input.write(key);
  }
  return pending;
}

describe("consumeSelectKeys", () => {
  test("parses arrows, digits, enter, space, y/n, and ctrl+c", () => {
    expect(consumeSelectKeys("\x1b[A\x1b[B\x1b[C\x1b[D")).toEqual({
      events: [{ type: "up" }, { type: "down" }, { type: "right" }, { type: "left" }],
      rest: "",
    });
    expect(consumeSelectKeys("\x1bOA2 \ryN\x03")).toEqual({
      events: [
        { type: "up" },
        { type: "digit", value: 2 },
        { type: "toggle" },
        { type: "submit" },
        { type: "yes" },
        { type: "no" },
        { type: "abort" },
      ],
      rest: "",
    });
    expect(consumeSelectKeys("\x1b[")).toEqual({ events: [], rest: "\x1b[" });
  });

  test("wraps the highlighted index", () => {
    expect(moveSelectIndex(0, -1, 4)).toBe(3);
    expect(moveSelectIndex(3, 1, 4)).toBe(0);
  });
});

describe("arrow prompts", () => {
  test("select uses down then enter", async () => {
    await expect(
      withKeys(
        (input, output) => promptSelect("Frontend", [...frontend], "api", { input, output }),
        ["\x1b[B", "\r"],
      ),
    ).resolves.toBe("server-htmx");
  });

  test("select uses a number key", async () => {
    await expect(
      withKeys(
        (input, output) => promptSelect("Frontend", [...frontend], "api", { input, output }),
        ["3"],
      ),
    ).resolves.toBe("spa-react");
  });

  test("confirm uses y and n", async () => {
    await expect(
      withKeys((input, output) => promptConfirm("Metrics token?", false, { input, output }), ["y"]),
    ).resolves.toBe(true);
    await expect(
      withKeys((input, output) => promptConfirm("Metrics token?", true, { input, output }), ["n"]),
    ).resolves.toBe(false);
  });

  test("multi-select toggles extras with space and numbers", async () => {
    const extras = [
      { value: "mfa", label: "mfa", enabled: false },
      { value: "scim", label: "scim", enabled: false },
      { value: "metrics", label: "metrics", enabled: true },
    ];
    await expect(
      withKeys(
        (input, output) => promptMultiSelect("Extras", extras, { input, output }),
        [" ", "\x1b[B", "2", "3", "\r"],
      ),
    ).resolves.toEqual(["mfa", "scim"]);
  });

  test("ctrl+c cancels", async () => {
    await expect(
      withKeys(
        (input, output) => promptSelect("Frontend", [...frontend], "api", { input, output }),
        ["\x03"],
      ),
    ).rejects.toBeInstanceOf(PromptCancelledError);
  });
});

describe("raw TTY detection", () => {
  test("hasRawMode requires isTTY and setRawMode", () => {
    expect(hasRawMode({ isTTY: true, setRawMode: () => undefined })).toBe(true);
    expect(hasRawMode({ isTTY: true })).toBe(false);
    expect(hasRawMode({})).toBe(false);
  });

  test("resolveSelectIo keeps an injected stream", () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const io = { input, output };
    expect(resolveSelectIo(io)).toBe(io);
  });
});

describe("createReadlinePrompter", () => {
  test("uses the arrow list when setRawMode exists", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
    };
    input.isTTY = true;
    input.setRawMode = () => undefined;
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => {
      text += chunk.toString();
    });
    const prompter = createReadlinePrompter({ input, output });
    const pending = prompter.select("Frontend", [...frontend], "api");
    await Promise.resolve();
    input.write("\x1b[B\r");
    await expect(pending).resolves.toBe("server-htmx");
    expect(text).toContain("↑/↓ and Enter");
    expect(text).not.toContain("Choose [");
  });

  test("falls back to Choose [N] when raw mode is missing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => {
      text += chunk.toString();
    });
    const prompter = createReadlinePrompter({ input, output });
    const pending = prompter.select("Frontend", [...frontend], "api");
    await Promise.resolve();
    await Promise.resolve();
    input.write("2\n");
    await expect(pending).resolves.toBe("server-htmx");
    expect(text).toContain("Choose [1]:");
    expect(text).not.toContain("↑/↓ and Enter");
  });
});
