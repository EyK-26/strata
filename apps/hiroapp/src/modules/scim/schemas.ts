export const SCIM_SCHEMAS = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  listResponse: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patchOp: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  serviceProviderConfig: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
} as const;

export interface ScimUserPayload {
  userName?: string;
  userType?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  active?: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
  roles?: Array<string | { value?: string }>;
}

export interface ScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

export function scimError(detail: string, status: number): Response {
  return Response.json(
    {
      schemas: [SCIM_SCHEMAS.error],
      detail,
      status: String(status),
    },
    { status, headers: { "content-type": "application/scim+json" } },
  );
}

export function scimJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "content-type": "application/scim+json" },
  });
}
