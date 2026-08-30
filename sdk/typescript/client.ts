export class WorkHubClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api/v1") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async getAdminFeatures(init: RequestInit = {}): Promise<Response> {
    return await this.request("/admin/features", { ...init, method: "GET" });
  }

  async getAdminOrganizationMembers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/admin/organization-members", { ...init, method: "GET" });
  }

  async getAdminStats(init: RequestInit = {}): Promise<Response> {
    return await this.request("/admin/stats", { ...init, method: "GET" });
  }

  async getAdminTenants(init: RequestInit = {}): Promise<Response> {
    return await this.request("/admin/tenants", { ...init, method: "GET" });
  }

  async getAttachmentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/attachments/{id}", { ...init, method: "GET" });
  }

  async deleteAttachmentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/attachments/{id}", { ...init, method: "DELETE" });
  }

  async getAttachmentsIdDownload(init: RequestInit = {}): Promise<Response> {
    return await this.request("/attachments/{id}/download", { ...init, method: "GET" });
  }

  async getAttachmentsIdThumbnail(init: RequestInit = {}): Promise<Response> {
    return await this.request("/attachments/{id}/thumbnail", { ...init, method: "GET" });
  }

  async getAuditLogs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/audit-logs", { ...init, method: "GET" });
  }

  async postAuthEmailVerificationNotification(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/email/verification-notification", { ...init, method: "POST" });
  }

  async postAuthForgotPassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/forgot-password", { ...init, method: "POST" });
  }

  async postAuthLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/login", { ...init, method: "POST" });
  }

  async getAuthMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/me", { ...init, method: "GET" });
  }

  async getAuthOauthProvider(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/oauth/{provider}", { ...init, method: "GET" });
  }

  async getAuthOauthProviderCallback(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/oauth/{provider}/callback", { ...init, method: "GET" });
  }

  async postAuthRegister(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/register", { ...init, method: "POST" });
  }

  async postAuthResetPassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/reset-password", { ...init, method: "POST" });
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

  async getBillingSubscription(init: RequestInit = {}): Promise<Response> {
    return await this.request("/billing/subscription", { ...init, method: "GET" });
  }

  async postBillingWebhooksStripe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/billing/webhooks/stripe", { ...init, method: "POST" });
  }

  async getComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/comments", { ...init, method: "GET" });
  }

  async getCommentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/comments/{id}", { ...init, method: "GET" });
  }

  async patchCommentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/comments/{id}", { ...init, method: "PATCH" });
  }

  async deleteCommentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/comments/{id}", { ...init, method: "DELETE" });
  }

  async postInvitationsAccept(init: RequestInit = {}): Promise<Response> {
    return await this.request("/invitations/accept", { ...init, method: "POST" });
  }

  async getOrganizations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations", { ...init, method: "GET" });
  }

  async postOrganizations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations", { ...init, method: "POST" });
  }

  async getOrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}", { ...init, method: "GET" });
  }

  async patchOrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}", { ...init, method: "PATCH" });
  }

  async deleteOrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}", { ...init, method: "DELETE" });
  }

  async getOrganizationsIdInvitations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/invitations", { ...init, method: "GET" });
  }

  async postOrganizationsIdInvitations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/invitations", { ...init, method: "POST" });
  }

  async deleteOrganizationsIdInvitationsInvitationId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/invitations/{invitationId}", { ...init, method: "DELETE" });
  }

  async getOrganizationsIdMembers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/members", { ...init, method: "GET" });
  }

  async postOrganizationsIdMembers(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/members", { ...init, method: "POST" });
  }

  async patchOrganizationsIdMembersUserId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/members/{userId}", { ...init, method: "PATCH" });
  }

  async deleteOrganizationsIdMembersUserId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/organizations/{id}/members/{userId}", { ...init, method: "DELETE" });
  }

  async getProjects(init: RequestInit = {}): Promise<Response> {
    return await this.request("/projects", { ...init, method: "GET" });
  }

  async postProjects(init: RequestInit = {}): Promise<Response> {
    return await this.request("/projects", { ...init, method: "POST" });
  }

  async getProjectsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/projects/{id}", { ...init, method: "GET" });
  }

  async patchProjectsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/projects/{id}", { ...init, method: "PATCH" });
  }

  async deleteProjectsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/projects/{id}", { ...init, method: "DELETE" });
  }

  async getReportsOrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/reports/organizations/{id}", { ...init, method: "GET" });
  }

  async getReportsSummary(init: RequestInit = {}): Promise<Response> {
    return await this.request("/reports/summary", { ...init, method: "GET" });
  }

  async getSearch(init: RequestInit = {}): Promise<Response> {
    return await this.request("/search", { ...init, method: "GET" });
  }

  async getTasks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks", { ...init, method: "GET" });
  }

  async postTasks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks", { ...init, method: "POST" });
  }

  async getTasksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}", { ...init, method: "GET" });
  }

  async patchTasksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}", { ...init, method: "PATCH" });
  }

  async deleteTasksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}", { ...init, method: "DELETE" });
  }

  async getTasksIdAttachments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}/attachments", { ...init, method: "GET" });
  }

  async postTasksIdAttachments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}/attachments", { ...init, method: "POST" });
  }

  async getTasksIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}/comments", { ...init, method: "GET" });
  }

  async postTasksIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}/comments", { ...init, method: "POST" });
  }

  async patchUsersMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me", { ...init, method: "PATCH" });
  }

  async deleteUsersMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me", { ...init, method: "DELETE" });
  }

  async postUsersMeConfirmPassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/confirm-password", { ...init, method: "POST" });
  }

  async getUsersMeConfirmedPasswordStatus(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/confirmed-password-status", { ...init, method: "GET" });
  }

  async getUsersMeCurrentOrganization(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/current-organization", { ...init, method: "GET" });
  }

  async putUsersMeCurrentOrganization(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/current-organization", { ...init, method: "PUT" });
  }

  async getUsersMeExport(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/export", { ...init, method: "GET" });
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

  async getUsersMeNotifications(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/notifications", { ...init, method: "GET" });
  }

  async patchUsersMeNotifications(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/notifications", { ...init, method: "PATCH" });
  }

  async patchUsersMeNotificationsIdRead(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/notifications/{id}/read", { ...init, method: "PATCH" });
  }

  async putUsersMePassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/password", { ...init, method: "PUT" });
  }

  async getUsersMePhoto(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/photo", { ...init, method: "GET" });
  }

  async postUsersMePhoto(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/photo", { ...init, method: "POST" });
  }

  async deleteUsersMePhoto(init: RequestInit = {}): Promise<Response> {
    return await this.request("/users/me/photo", { ...init, method: "DELETE" });
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

  async postWebhooksIdActivate(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks/{id}/activate", { ...init, method: "POST" });
  }

  async postWebhooksIdDeactivate(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks/{id}/deactivate", { ...init, method: "POST" });
  }

  async postWebhooksDeliveriesIdRetry(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks/deliveries/{id}/retry", { ...init, method: "POST" });
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
