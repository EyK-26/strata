import { expect, test } from "bun:test";
import { join } from "node:path";

function scenario(frontend: string, auth: string, extra: string[] = []) {
  test(`mounted generated ${frontend}/${auth}${extra.join("/")} uses its selected authentication transport`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/verify-starter-react-auth.ts",
        `--frontend=${frontend}`,
        `--auth=${auth}`,
        ...extra,
      ],
      {
        cwd: join(import.meta.dir, "../.."),
        stdout: "inherit",
        stderr: "inherit",
        timeout: 150000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 160000);
}
for (const frontend of ["spa-react", "hybrid"]) {
  for (const auth of ["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"]) {
    scenario(frontend, auth);
    scenario(frontend, auth, ["--dev"]);
  }
  scenario(frontend, "jwt", ["--expiry"]);
}
for (const auth of ["cookie", "cookie-token", "cookie-token-jwt"])
  scenario("hybrid", auth, ["--mfa"]);
