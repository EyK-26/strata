import { createAsyncContextStore } from "../runtime/asyncContextStore";

class TransactionRollback extends Error {
  readonly result: unknown;

  constructor(result: unknown) {
    super("Transaction rolled back");
    this.name = "TransactionRollback";
    this.result = result;
  }
}

type TransactionScopeState = {
  rollback: boolean[];
};

const transactionScopes = createAsyncContextStore<TransactionScopeState>(
  "@getstrata/transactionScopes",
);

function unwrapTransactionRollback(error: unknown, depth = 0): TransactionRollback | null {
  if (error instanceof TransactionRollback) {
    return error;
  }
  if (depth >= 5 || !(error instanceof Error) || error.cause === undefined) {
    return null;
  }
  return unwrapTransactionRollback(error.cause, depth + 1);
}

function requestTransactionRollback(): void {
  const state = transactionScopes.getStore();
  const index = state ? state.rollback.length - 1 : -1;
  if (!state || index < 0) {
    return;
  }
  const flags = state.rollback;
  const current = flags[index];
  if (current === undefined) {
    return;
  }
  flags[index] = true;
}

function scopeRequestsRollback(): boolean {
  const state = transactionScopes.getStore();
  if (!state || state.rollback.length === 0) {
    return false;
  }
  return state.rollback[state.rollback.length - 1] === true;
}

async function commitOrRollbackScope<T>(result: T): Promise<T> {
  if (scopeRequestsRollback()) {
    throw new TransactionRollback(result);
  }
  return result;
}

async function settleTransaction<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const rollback = unwrapTransactionRollback(error);
    if (rollback) {
      return rollback.result as T;
    }
    throw error;
  }
}

async function runWithTransactionScope<T>(callback: () => T | Promise<T>): Promise<T> {
  const existing = transactionScopes.getStore();
  if (existing) {
    existing.rollback.push(false);
    try {
      return await callback();
    } finally {
      existing.rollback.pop();
    }
  }

  const state: TransactionScopeState = { rollback: [false] };
  return await transactionScopes.run(state, callback);
}

export {
  commitOrRollbackScope,
  requestTransactionRollback,
  runWithTransactionScope,
  settleTransaction,
};
