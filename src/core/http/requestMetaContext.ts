import { createAsyncContextStore } from "../runtime/asyncContextStore";

type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
  request?: Request;
  flash?: { level: string; message: string } | null;
  csrfToken?: string;
  cspNonce?: string;
};

const requestMetaContext = createAsyncContextStore<RequestMeta>("@getstrata/requestMetaContext");

function runWithRequestMeta<T>(meta: RequestMeta, callback: () => T | Promise<T>): T | Promise<T> {
  return requestMetaContext.run(meta, callback);
}

function currentRequestMeta(): RequestMeta {
  return (
    requestMetaContext.getStore() ?? {
      ipAddress: null,
      userAgent: null,
    }
  );
}

export type { RequestMeta };
export { currentRequestMeta, requestMetaContext, runWithRequestMeta };
