import { verifyPassword } from "@getstrata/core/auth/password";
import { ForbiddenError, ValidationError } from "@getstrata/core/errors/http";
import { ApplicationResource } from "../../http/resources.ts";
import { isCandidate } from "../../lib/roles.ts";
import { runWithoutTenantScope } from "../../lib/tenantRepository.ts";
import { accountService } from "../account/service.ts";
import { apiTokens } from "../account/tokenRepository.ts";
import { tokenService } from "../account/tokenService.ts";
import { applicationService } from "../applications/service.ts";
import { careerService } from "../careers/service.ts";
import { interviewService, serializeInterview } from "../interviews/service.ts";
import { offerService } from "../offers/service.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";

export const CANDIDATE_PORTAL_ABILITIES = [
  "profile:read",
  "applications:read",
  "applications:write",
  "interviews:read",
  "offers:read",
];

export class ApplyService {
  async login(email: string, password: string) {
    const user = await users.findByEmail(email);
    if (!user || !(await verifyPassword(password, user.password))) {
      throw new ValidationError("The given data was invalid.", {
        email: ["These credentials do not match our records."],
      });
    }
    if (!isCandidate(user.role_id)) {
      throw new ForbiddenError("Use the staff sign-in at /login.");
    }
    const created = await tokenService.createToken(user.id, {
      name: "candidate-portal",
      abilities: [...CANDIDATE_PORTAL_ABILITIES],
      expiresInDays: 7,
    });
    return { user, plainTextToken: created.plainTextToken, token: created.token };
  }

  async logout(tokenId?: number) {
    if (!tokenId) {
      return { revoked: false };
    }
    const deleted = await runWithoutTenantScope(() => apiTokens.deleteById(tokenId));
    return { revoked: Boolean(deleted) };
  }

  async positions() {
    return careerService.listPublic();
  }

  async apply(
    user: UserRecord,
    payload: {
      position_id: number;
      attachment_text: string | null;
      attachment_file: string | null;
      source_id?: number | null;
    },
  ) {
    const application = await applicationService.apply(user, payload);
    return new ApplicationResource(application).toResponse();
  }

  async applications(user: UserRecord) {
    const page = await applicationService.listForActor(user, {}, { page: 1, perPage: 50 });
    return page.map((application) => new ApplicationResource(application).toArray());
  }

  async interviews(user: UserRecord) {
    const rows = await interviewService.listForActor(user);
    return rows.map(serializeInterview);
  }

  async offers(user: UserRecord) {
    const applications = await applicationService.listForActor(user, {}, { page: 1, perPage: 50 });
    const listed = await Promise.all(
      applications.map((application) =>
        offerService.serializedForApplication(Number(application.id)),
      ),
    );
    return listed.flat();
  }

  async updateProfile(user: UserRecord, firstName: string, lastName: string, email: string) {
    return accountService.updateProfile(user.id, firstName, lastName, email);
  }
}

export const applyService = new ApplyService();
