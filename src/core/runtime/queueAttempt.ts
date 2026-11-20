import type { ExecutionEnvelope } from "../contracts/application";
import { createAsyncContextStore } from "./asyncContextStore";

const queueAttempt = createAsyncContextStore<ExecutionEnvelope>("@getstrata/queueAttempt");

export { queueAttempt };
