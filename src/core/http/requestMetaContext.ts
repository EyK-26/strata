import { AsyncLocalStorage } from "node:async_hooks";

type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

const requestMetaContext = new AsyncLocalStorage<RequestMeta>();

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
