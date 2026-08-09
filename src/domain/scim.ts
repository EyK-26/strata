export const TEST_SCIM_BEARER_TOKEN = "workhub-scim-test-token";
export const DEFAULT_SCIM_BEARER_TOKEN = TEST_SCIM_BEARER_TOKEN;

export const SCIM_SCHEMAS = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  listResponse: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patchOp: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  serviceProviderConfig: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
} as const;
