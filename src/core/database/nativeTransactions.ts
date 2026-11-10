import type {
  ControlEvidence,
  ControlPhase,
  Decision,
  DecisionStage,
  FailureTag,
  NativeState,
  RawTransaction,
  SavepointTerminal,
  SqlStatement,
  Terminal,
} from "./driverPorts";

type NativeControl = {
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
  control(sql: string): Promise<{ command?: string | null }>;
  /** Local native evidence only; never derive this from an error's payload. */
  state?(): NativeState;
  beginSql?: string;
};
const failure = (error: unknown): FailureTag => Object.freeze({ error });
function nativeTransaction(control: NativeControl) {
  let state: NativeState = "idle";
  let sequence = 0;
  let running = false;
  const knownState = () => control.state?.() ?? "unknown";
  async function run<R>(
    work: (tx: RawTransaction) => Promise<Decision<R>>,
    savepoint?: string,
  ): Promise<Terminal<R> | SavepointTerminal<R>> {
    const phases: ControlEvidence[] = [];
    let stage: DecisionStage<R> = Object.freeze({ kind: "callback-not-entered" });
    let terminalFailure: FailureTag | null = null;
    let data: Terminal<R>["data"] | SavepointTerminal<R>["data"] = "not-started";
    let open = false;
    let childActive = false;
    const phase = async (name: ControlPhase, sql: string) => {
      try {
        const reply = await control.control(sql);
        phases.push(
          Object.freeze({ phase: name, acknowledgement: "confirmed-reply", failure: null }),
        );
        return reply;
      } catch (error) {
        const proof = knownState();
        phases.push(
          Object.freeze({
            phase: name,
            acknowledgement:
              (name === "commit" && proof === "transaction-active") ||
              (name === "begin" && proof === "idle")
                ? "proven-not-applied"
                : "unknown",
            failure: failure(error),
          }),
        );
        state = proof;
        throw error;
      }
    };
    const result = () =>
      Object.freeze({
        data,
        nativeState: state,
        stage,
        phases: Object.freeze([...phases]),
        failure: terminalFailure,
      }) as Terminal<R> | SavepointTerminal<R>;
    try {
      await phase(
        savepoint ? "savepoint" : "begin",
        savepoint ? `SAVEPOINT ${savepoint}` : (control.beginSql ?? "BEGIN"),
      );
      state = "transaction-active";
      open = true;
    } catch (error) {
      terminalFailure = failure(error);
      data = state === "idle" && !savepoint ? "not-started" : "unknown";
      return result();
    }
    const transaction: RawTransaction = Object.freeze({
      execute<Row>(statement: SqlStatement): Promise<readonly Row[]> {
        if (!open || childActive)
          return Promise.reject(new Error("Native transaction branch is not active."));
        return control.execute<Row>(statement);
      },
      async savepoint<T>(
        callback: (child: RawTransaction) => Promise<Decision<T>>,
      ): Promise<SavepointTerminal<T>> {
        if (!open || childActive) throw new Error("Native transaction branch is not active.");
        childActive = true;
        try {
          return (await run(callback, `strata_sp_${++sequence}`)) as SavepointTerminal<T>;
        } finally {
          childActive = false;
        }
      },
    });
    stage = Object.freeze({ kind: "callback-running" });
    try {
      const decision = await work(transaction);
      if (!decision || (decision.finish !== "commit" && decision.finish !== "rollback"))
        throw new TypeError("Invalid native transaction decision.");
      stage = Object.freeze({
        kind: "decided",
        decision: Object.freeze({ finish: decision.finish, result: decision.result }),
      });
    } catch (error) {
      stage = Object.freeze({ kind: "callback-failed", error });
    } finally {
      open = false;
    }
    const rollback = async () => {
      if (savepoint) {
        await phase("rollback-to", `ROLLBACK TO SAVEPOINT ${savepoint}`);
        await phase("release-savepoint", `RELEASE SAVEPOINT ${savepoint}`);
        state = "transaction-active";
      } else {
        await phase("rollback", "ROLLBACK");
        state = "idle";
      }
    };
    if (stage.kind === "decided" && stage.decision.finish === "commit") {
      try {
        const reply = await phase(
          savepoint ? "release-savepoint" : "commit",
          savepoint ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT",
        );
        // PostgreSQL can reply ROLLBACK to COMMIT on a failed transaction.
        data = savepoint ? "released" : reply.command === "ROLLBACK" ? "rolled-back" : "committed";
        state = savepoint ? "transaction-active" : "idle";
      } catch (error) {
        terminalFailure = failure(error);
        const commitNotApplied =
          !savepoint && state === "transaction-active" && control.state !== undefined;
        data = "unknown";
        try {
          await rollback();
          // A later rollback ACK proves idle, not that an uncertain COMMIT was undone.
          if (savepoint || commitNotApplied) data = "rolled-back";
        } catch {
          /* Each control failure remains separately tagged in phases. */
        }
      }
    } else {
      try {
        await rollback();
        data = "rolled-back";
      } catch (error) {
        terminalFailure = failure(error);
        data = "unknown";
      }
    }
    return result();
  }
  return {
    get state() {
      return state;
    },
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
      if (running) throw new Error("Native pin already has an active transaction.");
      running = true;
      try {
        return (await run(work)) as Terminal<R>;
      } finally {
        running = false;
      }
    },
  };
}

export type { NativeControl };
export { nativeTransaction };
