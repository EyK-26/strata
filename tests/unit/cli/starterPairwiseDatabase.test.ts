import { expect, test } from "bun:test";
import { starterLocalFixtureUrl } from "../../helpers/starterPairwiseDatabase";

test("qualification accepts only loopback fixture URLs with the selected protocol", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    expect(
      starterLocalFixtureUrl(`postgres://fixture@${host}:5432/owned`, ["postgres:"]).hostname,
    ).toBe(host);
  for (const value of [
    undefined,
    "postgres://fixture@db.example.com/owned",
    "postgres://fixture@10.0.0.1/owned",
    "https://localhost/owned",
  ])
    expect(() => starterLocalFixtureUrl(value, ["postgres:"])).toThrow();
  expect(starterLocalFixtureUrl("redis://localhost:6379", ["redis:"]).hostname).toBe("localhost");
});
