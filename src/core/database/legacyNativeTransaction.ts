import { type ActiveDatabaseHandle, runWithDatabaseConnection } from "./connectionContext";
import type { DisposeAck, FailureTag, RawPin, Terminal } from "./driverPorts";

/** Only old explicit adapters enter legacy connection routing; raw pools never import this. */
async function legacyNativeTransaction<R>(
  pin: RawPin,
  callback: (tx: ActiveDatabaseHandle) => Promise<R>,
  transactions: WeakSet<ActiveDatabaseHandle>,
): Promise<R> {
  let terminal: Terminal<R> | undefined;
  let unexpected: FailureTag | undefined;
  let disposal!: DisposeAck;
  try {
    terminal = await pin.begin(async (raw) => {
      let active = true;
      const transaction: ActiveDatabaseHandle = {
        async unsafe<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
          if (!active) throw new Error("Database transaction is no longer active.");
          return [...(await raw.execute<Row>({ text, params }))];
        },
      };
      transactions.add(transaction);
      try {
        const result = await runWithDatabaseConnection(transaction, () => callback(transaction));
        return { finish: "commit", result };
      } finally {
        active = false;
      }
    });
  } catch (error) {
    unexpected = { error };
  } finally {
    try {
      disposal = await (terminal?.nativeState === "idle" ? pin.release() : pin.discard());
    } catch (error) {
      disposal = { ok: false, error, ownership: "unknown" };
    }
  }
  let primary = unexpected;
  if (!primary && terminal) {
    if (terminal.stage.kind === "callback-failed") {
      primary = {
        error: terminal.failure
          ? new AggregateError(
              [terminal.stage.error, terminal.failure.error],
              "Native rollback failed; connection discarded.",
            )
          : terminal.stage.error,
      };
    } else if (terminal.failure) primary = terminal.failure;
    else if (terminal.stage.kind !== "decided" || terminal.data !== "committed")
      primary = { error: new Error("Native transaction did not commit.") };
  }
  if (!disposal.ok) {
    if (primary)
      throw new AggregateError(
        [primary.error, disposal.error],
        "Native transaction and disposal failed.",
      );
    throw disposal.error;
  }
  if (primary) throw primary.error;
  if (terminal?.stage.kind !== "decided") throw new Error("Native transaction has no decision.");
  return terminal.stage.decision.result;
}

export { legacyNativeTransaction };
