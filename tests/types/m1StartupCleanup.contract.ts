import {
  getM1StartupCleanupCompletion,
  type M1ApplicationOptions,
  type M1StartupCleanupOutcome,
} from "@getstrata/bootstrap/m1";

const options: M1ApplicationOptions = { modules: [], startupCleanupTimeoutMs: 1000 };
void options;
// @ts-expect-error Runtime validates numeric ranges; strings are not an option contract.
const bad: M1ApplicationOptions = { modules: [], startupCleanupTimeoutMs: "1000" };
void bad;
const completion: Promise<M1StartupCleanupOutcome> | undefined = getM1StartupCleanupCompletion(
  new Error("owned-type-fixture"),
);
void completion;
function readonlyOutcome(outcome: M1StartupCleanupOutcome) {
  // @ts-expect-error Completion dispositions are immutable.
  outcome.state = "cleaned";
  // @ts-expect-error Internal failure lists are immutable.
  outcome.errors.push(new Error("owned"));
}
void readonlyOutcome;
