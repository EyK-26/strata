/** Test-fixture address remapping only; generated application configuration stays unchanged. */
export function replaceFixtureLoopbackPort(text: string, port: number, hostPort: string): string {
  // A single pass and numeric boundary keep ephemeral ports such as 33060 intact.
  return text.replaceAll(
    new RegExp(`\\b(?:localhost|127\\.0\\.0\\.1):${port}(?!\\d)`, "g"),
    `127.0.0.1:${hostPort}`,
  );
}
