import { expect, test } from "bun:test";
import { join } from "node:path";
import { starterJourneyProfiles } from "../helpers/starterJourneyProfiles";

for (const profile of starterJourneyProfiles) {
  test(`starter journey ${profile.name}: signup, SMTP verification, reset, replay and credential revocation`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../../scripts/verify-starter-auth-journey.ts"),
        profile.name,
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
