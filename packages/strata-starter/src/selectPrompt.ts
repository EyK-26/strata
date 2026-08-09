import type { Readable, Writable } from "node:stream";
import tty from "node:tty";

type SelectChoice<T extends string> = { value: T; label: string };

type MultiSelectChoice<T extends string> = SelectChoice<T> & { enabled: boolean };

type SelectIo = {
  input: Readable & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  output: Writable;
};

function hasRawMode(input: { isTTY?: boolean; setRawMode?: (mode: boolean) => void }): boolean {
  return Boolean(input.isTTY && typeof input.setRawMode === "function");
}

let cachedFdIo: SelectIo | undefined;

function resolveSelectIo(preferred?: SelectIo): SelectIo {
  if (preferred) {
    return preferred;
  }
  const live: SelectIo = { input: process.stdin, output: process.stdout };
  if (hasRawMode(live.input)) {
    return live;
  }
  if (cachedFdIo && hasRawMode(cachedFdIo.input)) {
    return cachedFdIo;
  }
  if (tty.isatty(0)) {
    cachedFdIo = {
      input: new tty.ReadStream(0),
      output: tty.isatty(1) ? new tty.WriteStream(1) : process.stdout,
    };
    return cachedFdIo;
  }
  return live;
}

type SelectKeyEvent =
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "submit" }
  | { type: "toggle" }
  | { type: "yes" }
  | { type: "no" }
  | { type: "digit"; value: number }
  | { type: "abort" };

class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "PromptCancelledError";
  }
}

function consumeSelectKeys(buffer: string): { events: SelectKeyEvent[]; rest: string } {
  const events: SelectKeyEvent[] = [];
  let rest = buffer;

  while (rest.length > 0) {
    if (rest[0] === "\x1b") {
      if (rest.length === 1) {
        break;
      }
      if (rest.startsWith("\x1b[")) {
        const end = rest.search(/[A-Za-z]/);
        if (end < 2) {
          break;
        }
        const command = rest[end];
        rest = rest.slice(end + 1);
        if (command === "A") {
          events.push({ type: "up" });
        } else if (command === "B") {
          events.push({ type: "down" });
        } else if (command === "C") {
          events.push({ type: "right" });
        } else if (command === "D") {
          events.push({ type: "left" });
        }
        continue;
      }
      if (rest.startsWith("\x1bO")) {
        if (rest.length < 3) {
          break;
        }
        const command = rest[2];
        rest = rest.slice(3);
        if (command === "A") {
          events.push({ type: "up" });
        } else if (command === "B") {
          events.push({ type: "down" });
        } else if (command === "C") {
          events.push({ type: "right" });
        } else if (command === "D") {
          events.push({ type: "left" });
        }
        continue;
      }
      rest = rest.slice(1);
      events.push({ type: "abort" });
      continue;
    }

    const next = rest[0] ?? "";
    rest = rest.slice(1);
    if (next === "\x03") {
      events.push({ type: "abort" });
      continue;
    }
    if (next === "\r" || next === "\n") {
      events.push({ type: "submit" });
      continue;
    }
    if (next === " ") {
      events.push({ type: "toggle" });
      continue;
    }
    if (next === "y" || next === "Y") {
      events.push({ type: "yes" });
      continue;
    }
    if (next === "n" || next === "N") {
      events.push({ type: "no" });
      continue;
    }
    if (next >= "1" && next <= "9") {
      events.push({ type: "digit", value: Number(next) });
    }
  }

  return { events, rest };
}

function moveSelectIndex(index: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + delta + length) % length;
}

function highlight(line: string, on: boolean): string {
  return on ? `\x1b[7m${line}\x1b[0m` : line;
}

function renderSelectLines<T extends string>(
  message: string,
  choices: Array<SelectChoice<T>>,
  index: number,
): string[] {
  return [
    message,
    ...choices.map((choice, choiceIndex) => {
      const selected = choiceIndex === index;
      const marker = selected ? ">" : " ";
      return highlight(`  ${marker} ${choiceIndex + 1}) ${choice.label}`, selected);
    }),
    `  ↑/↓ and Enter, or 1-${choices.length}`,
  ];
}

function renderConfirmLines(message: string, yes: boolean): string[] {
  return [
    message,
    highlight(`  ${yes ? ">" : " "} yes`, yes),
    highlight(`  ${yes ? " " : ">"} no`, !yes),
    "  ↑/↓ and Enter, or y / n",
  ];
}

function renderMultiSelectLines<T extends string>(
  message: string,
  choices: Array<MultiSelectChoice<T>>,
  index: number,
): string[] {
  return [
    message,
    ...choices.map((choice, choiceIndex) => {
      const focused = choiceIndex === index;
      const box = choice.enabled ? "[x]" : "[ ]";
      const marker = focused ? ">" : " ";
      return highlight(`  ${marker} ${box} ${choiceIndex + 1}) ${choice.label}`, focused);
    }),
    "  ↑/↓ move, Space or 1-9 toggle, Enter to continue",
  ];
}

function writeLines(output: Writable, lines: string[]): void {
  for (const line of lines) {
    output.write(`\x1b[2K${line}\n`);
  }
}

function clearDrawnLines(output: Writable, lineCount: number): void {
  if (lineCount <= 0) {
    return;
  }
  output.write(`\x1b[${lineCount}F`);
  for (let i = 0; i < lineCount; i += 1) {
    output.write("\x1b[2K\n");
  }
  output.write(`\x1b[${lineCount}F`);
}

function runRawPrompt<T>(
  io: SelectIo,
  render: () => string[],
  onEvent: (event: SelectKeyEvent) => { done: T } | "continue" | "abort",
  summary: (result: T) => string,
): Promise<T> {
  const { input, output } = io;
  const wasRaw = Boolean(input.isTTY && typeof input.setRawMode === "function");
  let buffer = "";
  let lineCount = 0;
  let settled = false;

  const restore = () => {
    output.write("\x1b[?25h");
    if (wasRaw) {
      input.setRawMode?.(false);
    }
  };

  const paint = () => {
    const lines = render();
    if (lineCount > 0) {
      output.write(`\x1b[${lineCount}F`);
    }
    writeLines(output, lines);
    lineCount = lines.length;
  };

  input.setEncoding("utf8");
  if (wasRaw) {
    input.setRawMode?.(true);
  }
  if (typeof input.resume === "function") {
    input.resume();
  }
  output.write("\x1b[?25l");
  paint();

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      input.off("data", onData);
      restore();
    };

    const succeed = (result: T) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      clearDrawnLines(output, lineCount);
      output.write(`${summary(result)}\n`);
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      clearDrawnLines(output, lineCount);
      reject(error);
    };

    function onData(chunk: string | Buffer) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const consumed = consumeSelectKeys(buffer);
      buffer = consumed.rest;
      for (const event of consumed.events) {
        const outcome = onEvent(event);
        if (outcome === "abort") {
          fail(new PromptCancelledError());
          return;
        }
        if (outcome === "continue") {
          paint();
          continue;
        }
        succeed(outcome.done);
        return;
      }
    }

    input.on("data", onData);
  });
}

async function promptSelect<T extends string>(
  message: string,
  choices: Array<SelectChoice<T>>,
  defaultValue: T,
  io: SelectIo,
): Promise<T> {
  if (choices.length === 0) {
    throw new Error(`No choices for "${message}".`);
  }

  const found = choices.findIndex((choice) => choice.value === defaultValue);
  let index = found >= 0 ? found : 0;

  return runRawPrompt(
    io,
    () => renderSelectLines(message, choices, index),
    (event) => {
      if (event.type === "abort") {
        return "abort";
      }
      if (event.type === "up") {
        index = moveSelectIndex(index, -1, choices.length);
        return "continue";
      }
      if (event.type === "down") {
        index = moveSelectIndex(index, 1, choices.length);
        return "continue";
      }
      if (event.type === "digit") {
        if (event.value >= 1 && event.value <= choices.length) {
          const choice = choices[event.value - 1];
          if (choice) {
            return { done: choice.value };
          }
        }
        return "continue";
      }
      if (event.type === "submit") {
        const choice = choices[index];
        if (choice) {
          return { done: choice.value };
        }
      }
      return "continue";
    },
    (value) => `${message}  ${choices.find((choice) => choice.value === value)?.label ?? value}`,
  );
}

async function promptConfirm(
  message: string,
  defaultValue: boolean,
  io: SelectIo,
): Promise<boolean> {
  let yes = defaultValue;

  return runRawPrompt(
    io,
    () => renderConfirmLines(message, yes),
    (event) => {
      if (event.type === "abort") {
        return "abort";
      }
      if (event.type === "up" || event.type === "right" || event.type === "yes") {
        if (event.type === "yes") {
          return { done: true };
        }
        yes = true;
        return "continue";
      }
      if (event.type === "down" || event.type === "left" || event.type === "no") {
        if (event.type === "no") {
          return { done: false };
        }
        yes = false;
        return "continue";
      }
      if (event.type === "digit") {
        if (event.value === 1) {
          return { done: true };
        }
        if (event.value === 2) {
          return { done: false };
        }
      }
      if (event.type === "submit") {
        return { done: yes };
      }
      return "continue";
    },
    (value) => `${message}  ${value ? "yes" : "no"}`,
  );
}

async function promptMultiSelect<T extends string>(
  message: string,
  choices: Array<MultiSelectChoice<T>>,
  io: SelectIo,
): Promise<T[]> {
  if (choices.length === 0) {
    return [];
  }

  const selected = choices.map((choice) => choice.enabled);
  let index = 0;

  const enabledValues = () =>
    choices.filter((_, choiceIndex) => selected[choiceIndex]).map((choice) => choice.value);

  return runRawPrompt(
    io,
    () =>
      renderMultiSelectLines(
        message,
        choices.map((choice, choiceIndex) => ({
          ...choice,
          enabled: Boolean(selected[choiceIndex]),
        })),
        index,
      ),
    (event) => {
      if (event.type === "abort") {
        return "abort";
      }
      if (event.type === "up") {
        index = moveSelectIndex(index, -1, choices.length);
        return "continue";
      }
      if (event.type === "down") {
        index = moveSelectIndex(index, 1, choices.length);
        return "continue";
      }
      if (event.type === "toggle") {
        selected[index] = !selected[index];
        return "continue";
      }
      if (event.type === "digit") {
        if (event.value >= 1 && event.value <= choices.length) {
          const target = event.value - 1;
          selected[target] = !selected[target];
          index = target;
        }
        return "continue";
      }
      if (event.type === "submit") {
        return { done: enabledValues() };
      }
      return "continue";
    },
    (values) => {
      const labels = choices
        .filter((choice) => values.includes(choice.value))
        .map((choice) => choice.value);
      return `${message}  ${labels.length > 0 ? labels.join(", ") : "none"}`;
    },
  );
}

export type { MultiSelectChoice, SelectChoice, SelectIo, SelectKeyEvent };
export {
  consumeSelectKeys,
  hasRawMode,
  moveSelectIndex,
  PromptCancelledError,
  promptConfirm,
  promptMultiSelect,
  promptSelect,
  renderConfirmLines,
  renderMultiSelectLines,
  renderSelectLines,
  resolveSelectIo,
};
