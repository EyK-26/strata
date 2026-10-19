import { expect, test } from "bun:test";
import { join } from "node:path";
import { starterResetRaceProfiles } from "../helpers/starterJourneyProfiles";

for (const profile of starterResetRaceProfiles) {
  test(`starter reset contention ${profile}: one proof, two guest clients, one committed password`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../../scripts/verify-starter-auth-journey.ts"),
        profile,
        "--reset-race",
      ],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 180000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 190000);
}
