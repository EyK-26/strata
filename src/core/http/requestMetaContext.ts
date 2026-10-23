import { createAsyncContextStore } from "../runtime/asyncContextStore";

type RequestMeta = {
  ipAddress: string | null;
  /** Immediate socket peer recorded by the transport; never a forwarded client header. */
  peerAddress?: string | null;
  userAgent: string | null;
  request?: Request;
  /** Canonical correlation identity shared by response policies and logging. */
  requestId?: string;
  /** Registered route template; never a URL supplied by the client. */
  routeTemplate?: string;
  /** API error contracts take precedence over client content negotiation. */
  errorFormat?: "json";
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

function resolveRequestId(request: Request): string {
  const meta = currentRequestMeta();
  return (
    (meta.request === request ? meta.requestId : undefined) ??
    request.headers.get("x-request-id") ??
    crypto.randomUUID()
  );
}

export type { RequestMeta };
export { currentRequestMeta, requestMetaContext, resolveRequestId, runWithRequestMeta };
