export const STARTUP_PROBE_MODES = [
  "success",
  "register-failure",
  "boot-failure",
  "dependency-missing",
  "close-failure",
  "flush-failure",
  "drain-failure",
  "startup-drain-failure",
  "route-factory-failure",
  "route-getter",
  "route-proxy",
  "orphan-metadata",
  "native-bad-pattern",
  "native-bind-failure",
  "native-bind-close-failure",
  "late-handler-failure",
] as const;
export type Mode = (typeof STARTUP_PROBE_MODES)[number];
export interface ProbeCase {
  mode: Mode;
  classification: "contract-control" | "feasibility-observation" | "confirmed-defect-reproduction";
  expectedFactoryCalls: number;
}
