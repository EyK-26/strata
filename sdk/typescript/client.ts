export class HiroAppClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async getApplicationSources(init: RequestInit = {}): Promise<Response> {
    return await this.request("/application-sources", { ...init, method: "GET" });
  }

  async getApplications(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications", { ...init, method: "GET" });
  }

  async postApplications(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications", { ...init, method: "POST" });
  }

  async getApplicationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}", { ...init, method: "GET" });
  }

  async getApplicationsIdBackgroundCheck(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/background-check", { ...init, method: "GET" });
  }

  async postApplicationsIdBackgroundCheck(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/background-check", { ...init, method: "POST" });
  }

  async getApplicationsIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/comments", { ...init, method: "GET" });
  }

  async postApplicationsIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/comments", { ...init, method: "POST" });
  }

  async postApplicationsIdEnd(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/end", { ...init, method: "POST" });
  }

  async getApplicationsIdHold(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/hold", { ...init, method: "GET" });
  }

  async postApplicationsIdHold(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/hold", { ...init, method: "POST" });
  }

  async getApplicationsIdInterviews(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/interviews", { ...init, method: "GET" });
  }

  async postApplicationsIdMove(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/move", { ...init, method: "POST" });
  }

  async getApplicationsIdOffers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/offers", { ...init, method: "GET" });
  }

  async postApplicationsIdOffers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/offers", { ...init, method: "POST" });
  }

  async postApplicationsIdOffersFromTemplate(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/offers/from-template", { ...init, method: "POST" });
  }

  async getApplicationsIdOnboarding(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/onboarding", { ...init, method: "GET" });
  }

  async postApplicationsIdOnboarding(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/onboarding", { ...init, method: "POST" });
  }

  async postApplicationsIdReject(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/reject", { ...init, method: "POST" });
  }

  async getApplicationsIdRejections(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/rejections", { ...init, method: "GET" });
  }

  async postApplicationsIdRestore(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/restore", { ...init, method: "POST" });
  }

  async getApplicationsIdSource(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/source", { ...init, method: "GET" });
  }

  async postApplicationsIdSource(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/source", { ...init, method: "POST" });
  }

  async getApplicationsIdTalentPool(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/talent-pool", { ...init, method: "GET" });
  }

  async postApplicationsIdTalentPool(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/talent-pool", { ...init, method: "POST" });
  }

  async postApplicationsIdTransfer(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/transfer", { ...init, method: "POST" });
  }

  async postApplicationsIdWithdraw(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/{id}/withdraw", { ...init, method: "POST" });
  }

  async postApplicationsNotify(init: RequestInit = {}): Promise<Response> {
    return await this.request("/applications/notify", { ...init, method: "POST" });
  }

  async getAuditLogs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/audit-logs", { ...init, method: "GET" });
  }

  async getAuditLogsExport(init: RequestInit = {}): Promise<Response> {
    return await this.request("/audit-logs/export", { ...init, method: "GET" });
  }

  async postAuthToken(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/token", { ...init, method: "POST" });
  }

  async getAuthTokens(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/tokens", { ...init, method: "GET" });
  }

  async postAuthTokens(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/tokens", { ...init, method: "POST" });
  }

  async deleteAuthTokensId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/tokens/{id}", { ...init, method: "DELETE" });
  }

  async postAuthTwoFactorChallenge(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/two-factor-challenge", { ...init, method: "POST" });
  }

  async postBackgroundChecksIdCancel(init: RequestInit = {}): Promise<Response> {
    return await this.request("/background-checks/{id}/cancel", { ...init, method: "POST" });
  }

  async postBackgroundChecksIdClear(init: RequestInit = {}): Promise<Response> {
    return await this.request("/background-checks/{id}/clear", { ...init, method: "POST" });
  }

  async postBackgroundChecksIdFlag(init: RequestInit = {}): Promise<Response> {
    return await this.request("/background-checks/{id}/flag", { ...init, method: "POST" });
  }

  async getBillingSubscription(init: RequestInit = {}): Promise<Response> {
    return await this.request("/billing/subscription", { ...init, method: "GET" });
  }

  async getCareers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/careers", { ...init, method: "GET" });
  }

  async getCareersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/careers/{id}", { ...init, method: "GET" });
  }

  async postCareersIdExpire(init: RequestInit = {}): Promise<Response> {
    return await this.request("/careers/{id}/expire", { ...init, method: "POST" });
  }

  async postCareersIdPin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/careers/{id}/pin", { ...init, method: "POST" });
  }

  async postCareersIdUnpin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/careers/{id}/unpin", { ...init, method: "POST" });
  }

  async postCareersIdUnpublish(init: RequestInit = {}): Promise<Response> {
    return await this.request("/careers/{id}/unpublish", { ...init, method: "POST" });
  }

  async getCatalog(init: RequestInit = {}): Promise<Response> {
    return await this.request("/catalog", { ...init, method: "GET" });
  }

  async getDashboardCount(init: RequestInit = {}): Promise<Response> {
    return await this.request("/dashboard/count", { ...init, method: "GET" });
  }

  async getDashboardData(init: RequestInit = {}): Promise<Response> {
    return await this.request("/dashboard/data", { ...init, method: "GET" });
  }

  async getDepartments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments", { ...init, method: "GET" });
  }

  async postDepartments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments", { ...init, method: "POST" });
  }

  async postDepartmentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}", { ...init, method: "POST" });
  }

  async getDepartmentsIdApplications(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/applications", { ...init, method: "GET" });
  }

  async postDepartmentsIdDelete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/delete", { ...init, method: "POST" });
  }

  async postDepartmentsIdFreeze(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/freeze", { ...init, method: "POST" });
  }

  async getDepartmentsIdInvitations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/invitations", { ...init, method: "GET" });
  }

  async postDepartmentsIdInvitations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/invitations", { ...init, method: "POST" });
  }

  async getDepartmentsIdMembers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/members", { ...init, method: "GET" });
  }

  async postDepartmentsIdMembers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/members", { ...init, method: "POST" });
  }

  async deleteDepartmentsIdMembersUserId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/members/{userId}", { ...init, method: "DELETE" });
  }

  async postDepartmentsIdUnfreeze(init: RequestInit = {}): Promise<Response> {
    return await this.request("/departments/{id}/unfreeze", { ...init, method: "POST" });
  }

  async getExportApplications(init: RequestInit = {}): Promise<Response> {
    return await this.request("/export/applications", { ...init, method: "GET" });
  }

  async getFailedJobs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/failed-jobs", { ...init, method: "GET" });
  }

  async postFailedJobsIdRetry(init: RequestInit = {}): Promise<Response> {
    return await this.request("/failed-jobs/{id}/retry", { ...init, method: "POST" });
  }

  async postHoldsIdRelease(init: RequestInit = {}): Promise<Response> {
    return await this.request("/holds/{id}/release", { ...init, method: "POST" });
  }

  async getIntegrationsPing(init: RequestInit = {}): Promise<Response> {
    return await this.request("/integrations/ping", { ...init, method: "GET" });
  }

  async getInterviews(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews", { ...init, method: "GET" });
  }

  async postInterviews(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews", { ...init, method: "POST" });
  }

  async postInterviewsIdCancel(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/cancel", { ...init, method: "POST" });
  }

  async postInterviewsIdComplete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/complete", { ...init, method: "POST" });
  }

  async getInterviewsIdConfirm(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/confirm", { ...init, method: "GET" });
  }

  async postInterviewsIdConfirm(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/confirm", { ...init, method: "POST" });
  }

  async postInterviewsIdDecline(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/decline", { ...init, method: "POST" });
  }

  async postInterviewsIdNoShow(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/no-show", { ...init, method: "POST" });
  }

  async postInterviewsIdReschedule(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/reschedule", { ...init, method: "POST" });
  }

  async getInterviewsIdScorecards(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/scorecards", { ...init, method: "GET" });
  }

  async postInterviewsIdScorecards(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/{id}/scorecards", { ...init, method: "POST" });
  }

  async getInterviewsConfirm(init: RequestInit = {}): Promise<Response> {
    return await this.request("/interviews/confirm", { ...init, method: "GET" });
  }

  async postLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/login", { ...init, method: "POST" });
  }

  async postLogout(init: RequestInit = {}): Promise<Response> {
    return await this.request("/logout", { ...init, method: "POST" });
  }

  async getMeSkills(init: RequestInit = {}): Promise<Response> {
    return await this.request("/me/skills", { ...init, method: "GET" });
  }

  async postMeSkills(init: RequestInit = {}): Promise<Response> {
    return await this.request("/me/skills", { ...init, method: "POST" });
  }

  async getMeWatching(init: RequestInit = {}): Promise<Response> {
    return await this.request("/me/watching", { ...init, method: "GET" });
  }

  async getMerges(init: RequestInit = {}): Promise<Response> {
    return await this.request("/merges", { ...init, method: "GET" });
  }

  async postMerges(init: RequestInit = {}): Promise<Response> {
    return await this.request("/merges", { ...init, method: "POST" });
  }

  async postNotify(init: RequestInit = {}): Promise<Response> {
    return await this.request("/notify", { ...init, method: "POST" });
  }

  async getNotifyGet(init: RequestInit = {}): Promise<Response> {
    return await this.request("/notify/get", { ...init, method: "GET" });
  }

  async postNotifyMarkasread(init: RequestInit = {}): Promise<Response> {
    return await this.request("/notify/markasread", { ...init, method: "POST" });
  }

  async getOfferTemplates(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offer-templates", { ...init, method: "GET" });
  }

  async postOfferTemplates(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offer-templates", { ...init, method: "POST" });
  }

  async postOfferTemplatesIdDelete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offer-templates/{id}/delete", { ...init, method: "POST" });
  }

  async postOfferTemplatesIdUpdate(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offer-templates/{id}/update", { ...init, method: "POST" });
  }

  async postOffersIdAccept(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offers/{id}/accept", { ...init, method: "POST" });
  }

  async postOffersIdDecline(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offers/{id}/decline", { ...init, method: "POST" });
  }

  async postOffersIdExpire(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offers/{id}/expire", { ...init, method: "POST" });
  }

  async postOffersIdSend(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offers/{id}/send", { ...init, method: "POST" });
  }

  async postOffersIdWithdraw(init: RequestInit = {}): Promise<Response> {
    return await this.request("/offers/{id}/withdraw", { ...init, method: "POST" });
  }

  async postOnboardingIdComplete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/onboarding/{id}/complete", { ...init, method: "POST" });
  }

  async getPipelineSummary(init: RequestInit = {}): Promise<Response> {
    return await this.request("/pipeline/summary", { ...init, method: "GET" });
  }

  async getPositions(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions", { ...init, method: "GET" });
  }

  async postPositions(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions", { ...init, method: "POST" });
  }

  async getPositionsDepDepartment(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions-dep/{department}", { ...init, method: "GET" });
  }

  async getPositionsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}", { ...init, method: "GET" });
  }

  async postPositionsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}", { ...init, method: "POST" });
  }

  async getPositionsIdCareer(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/career", { ...init, method: "GET" });
  }

  async postPositionsIdCareer(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/career", { ...init, method: "POST" });
  }

  async postPositionsIdClose(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/close", { ...init, method: "POST" });
  }

  async getPositionsIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/comments", { ...init, method: "GET" });
  }

  async postPositionsIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/comments", { ...init, method: "POST" });
  }

  async postPositionsIdDelete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/delete", { ...init, method: "POST" });
  }

  async getPositionsIdInterviewers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/interviewers", { ...init, method: "GET" });
  }

  async postPositionsIdInterviewers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/interviewers", { ...init, method: "POST" });
  }

  async getPositionsIdMatch(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/match", { ...init, method: "GET" });
  }

  async getPositionsIdReferrals(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/referrals", { ...init, method: "GET" });
  }

  async postPositionsIdReferrals(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/referrals", { ...init, method: "POST" });
  }

  async postPositionsIdReopen(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/reopen", { ...init, method: "POST" });
  }

  async getPositionsIdRequisition(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/requisition", { ...init, method: "GET" });
  }

  async postPositionsIdRequisition(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/requisition", { ...init, method: "POST" });
  }

  async postPositionsIdRestore(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/restore", { ...init, method: "POST" });
  }

  async getPositionsIdSkills(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/skills", { ...init, method: "GET" });
  }

  async postPositionsIdSkills(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/skills", { ...init, method: "POST" });
  }

  async getPositionsIdSlots(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/slots", { ...init, method: "GET" });
  }

  async postPositionsIdSlots(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/slots", { ...init, method: "POST" });
  }

  async postPositionsIdWatch(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/{id}/watch", { ...init, method: "POST" });
  }

  async getPositionsAll(init: RequestInit = {}): Promise<Response> {
    return await this.request("/positions/all", { ...init, method: "GET" });
  }

  async getReferrals(init: RequestInit = {}): Promise<Response> {
    return await this.request("/referrals", { ...init, method: "GET" });
  }

  async postReferralsIdClose(init: RequestInit = {}): Promise<Response> {
    return await this.request("/referrals/{id}/close", { ...init, method: "POST" });
  }

  async getRejectionReasons(init: RequestInit = {}): Promise<Response> {
    return await this.request("/rejection-reasons", { ...init, method: "GET" });
  }

  async getRequisitions(init: RequestInit = {}): Promise<Response> {
    return await this.request("/requisitions", { ...init, method: "GET" });
  }

  async postRequisitionsIdApprove(init: RequestInit = {}): Promise<Response> {
    return await this.request("/requisitions/{id}/approve", { ...init, method: "POST" });
  }

  async postRequisitionsIdReject(init: RequestInit = {}): Promise<Response> {
    return await this.request("/requisitions/{id}/reject", { ...init, method: "POST" });
  }

  async getSkills(init: RequestInit = {}): Promise<Response> {
    return await this.request("/skills", { ...init, method: "GET" });
  }

  async postSlotsIdBook(init: RequestInit = {}): Promise<Response> {
    return await this.request("/slots/{id}/book", { ...init, method: "POST" });
  }

  async postSlotsIdCancel(init: RequestInit = {}): Promise<Response> {
    return await this.request("/slots/{id}/cancel", { ...init, method: "POST" });
  }

  async postTagsIdDelete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tags/{id}/delete", { ...init, method: "POST" });
  }

  async getTalentPool(init: RequestInit = {}): Promise<Response> {
    return await this.request("/talent-pool", { ...init, method: "GET" });
  }

  async postTalentPool(init: RequestInit = {}): Promise<Response> {
    return await this.request("/talent-pool", { ...init, method: "POST" });
  }

  async postTalentPoolIdReachOut(init: RequestInit = {}): Promise<Response> {
    return await this.request("/talent-pool/{id}/reach-out", { ...init, method: "POST" });
  }

  async postTalentPoolIdRelease(init: RequestInit = {}): Promise<Response> {
    return await this.request("/talent-pool/{id}/release", { ...init, method: "POST" });
  }

  async getUser(init: RequestInit = {}): Promise<Response> {
    return await this.request("/user", { ...init, method: "GET" });
  }

  async getUsers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users", { ...init, method: "GET" });
  }

  async postUsers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users", { ...init, method: "POST" });
  }

  async getUsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/{id}", { ...init, method: "GET" });
  }

  async postUsersIdDelete(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/{id}/delete", { ...init, method: "POST" });
  }

  async getUsersIdTags(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/{id}/tags", { ...init, method: "GET" });
  }

  async postUsersIdTags(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/{id}/tags", { ...init, method: "POST" });
  }

  async postUsersIdTalentPool(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/{id}/talent-pool", { ...init, method: "POST" });
  }

  async getUsersMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me", { ...init, method: "GET" });
  }

  async patchUsersMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me", { ...init, method: "PATCH" });
  }

  async postUsersMeConfirmPassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/confirm-password", { ...init, method: "POST" });
  }

  async getUsersMeConfirmedPasswordStatus(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/confirmed-password-status", { ...init, method: "GET" });
  }

  async putUsersMeCurrentDepartment(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/current-department", { ...init, method: "PUT" });
  }

  async getUsersMeDepartments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/departments", { ...init, method: "GET" });
  }

  async getUsersMeInvitations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/invitations", { ...init, method: "GET" });
  }

  async deleteUsersMeInvitationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/invitations/{id}", { ...init, method: "DELETE" });
  }

  async postUsersMeInvitationsIdAccept(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/invitations/{id}/accept", { ...init, method: "POST" });
  }

  async postUsersMeLogoutOtherDevices(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/logout-other-devices", { ...init, method: "POST" });
  }

  async postUsersMeMfa(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/mfa", { ...init, method: "POST" });
  }

  async deleteUsersMeMfa(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/mfa", { ...init, method: "DELETE" });
  }

  async postUsersMeMfaConfirm(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/mfa/confirm", { ...init, method: "POST" });
  }

  async postUsersMeMfaRecoveryCodes(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/mfa/recovery-codes", { ...init, method: "POST" });
  }

  async putUsersMePassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/password", { ...init, method: "PUT" });
  }

  async getUsersMeSessions(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/sessions", { ...init, method: "GET" });
  }

  async deleteUsersMeSessionsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/sessions/{id}", { ...init, method: "DELETE" });
  }

  async getWebhooks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks", { ...init, method: "GET" });
  }

  async postWebhooks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks", { ...init, method: "POST" });
  }

  async deleteWebhooksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks/{id}", { ...init, method: "DELETE" });
  }

  async postWebhooksIdDeactivate(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks/{id}/deactivate", { ...init, method: "POST" });
  }

  async postBillingWebhooksStripe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/billing/webhooks/stripe", { ...init, method: "POST" });
  }

  async getHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "GET" });
  }

  async getMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "GET" });
  }

  async getReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "GET" });
  }

  async getScimV2Groups(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Groups", { ...init, method: "GET" });
  }

  async getScimV2GroupsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Groups/{id}", { ...init, method: "GET" });
  }

  async patchScimV2GroupsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Groups/{id}", { ...init, method: "PATCH" });
  }

  async getScimV2ServiceProviderConfig(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/ServiceProviderConfig", { ...init, method: "GET" });
  }

  async getScimV2Users(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users", { ...init, method: "GET" });
  }

  async postScimV2Users(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users", { ...init, method: "POST" });
  }

  async getScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "GET" });
  }

  async patchScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "PATCH" });
  }

  async deleteScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "DELETE" });
  }

}
