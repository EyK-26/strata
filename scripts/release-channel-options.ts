import type { ReleaseChannel } from "./release-policy.ts";

function takeReleaseChannel(args: readonly string[]): { channel: ReleaseChannel; args: string[] } {
  const remaining: string[] = [];
  let selected: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--notes") {
      remaining.push(arg);
      const notes = args[++index];
      if (notes !== undefined) remaining.push(notes);
    } else if (arg === "--channel" || arg.startsWith("--channel=")) {
      if (selected !== undefined) throw new Error("Select one release channel.");
      selected = arg === "--channel" ? args[++index] : arg.slice("--channel=".length);
      if (selected !== "stable" && selected !== "next")
        throw new Error("Release channel must be stable or next.");
    } else remaining.push(arg);
  }
  return { channel: selected === "next" ? "next" : "stable", args: remaining };
}

export { takeReleaseChannel };
