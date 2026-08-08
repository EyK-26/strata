import { describe, expect, test } from "bun:test";
import { SCIM_SCHEMAS } from "../../src/domain/scim";
import OrganizationMemberRepository from "../../src/modules/organization/memberRepository";
import ScimService from "../../src/modules/scim/service";
import UserRepository from "../../src/modules/user/repository";

describe("ScimService", () => {
  test("returns service provider config", () => {
    const service = new ScimService(new UserRepository(), new OrganizationMemberRepository());
    const config = service.serviceProviderConfig();

    expect(config.schemas).toContain(SCIM_SCHEMAS.serviceProviderConfig);
    expect(config.patch.supported).toBe(true);
  });
});
