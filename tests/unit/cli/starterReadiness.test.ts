import { expect, test } from "bun:test";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { renderDockerCompose } from "../../../packages/strata-starter/src/renderEnv.ts";
import { dockerComposeUpCommand } from "../../../packages/strata-starter/src/types.ts";

for (const database of ["mysql", "postgres"] as const) {
  test(`generated ${database} and supporting services have real readiness probes`, () => {
    const layers = layersFromFlags(
      parseCreateStrataArgs([
        `--database=${database}`,
        "--cache=redis",
        "--mail=smtp",
        `--docker-services=${database},redis,mailpit,adminer`,
      ]),
    );
    const compose = renderDockerCompose("ready-app", layers);
    if (!compose) throw new Error("Expected selected Compose services");
    expect(compose.match(/healthcheck:/g)).toHaveLength(4);
    expect(compose).toContain("SELECT 1");
    expect(compose).toContain(database === "mysql" ? "MYSQL_PWD" : "PGPASSWORD");
    expect(compose).toContain("127.0.0.1");
    expect(compose).toContain("service_healthy");
    expect(compose).toContain("redis-cli");
    expect(compose).toContain("PONG");
    expect(compose).toMatch(/"\/mailpit",\s*"readyz"/);
    expect(dockerComposeUpCommand(layers)).toBe(
      "docker compose --profile debug up -d --wait --wait-timeout 180",
    );
  });
}
test("required services without Adminer also wait and Local never adds services", () => {
  const flags = ["--database=mysql", "--docker"];
  const layers = layersFromFlags(parseCreateStrataArgs(flags));
  expect(dockerComposeUpCommand(layers)).toBe("docker compose up -d --wait --wait-timeout 180");
  expect(renderDockerCompose("ready-app", layers)).not.toContain("adminer:");
  expect(
    renderDockerCompose(
      "ready-app",
      layersFromFlags(parseCreateStrataArgs(["--database=mysql", "--no-docker"])),
    ),
  ).toBeNull();
});
