export class WorkHubClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api/v1") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async getApiV1Audit-logs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/audit-logs", { ...init, method: "GET" });
  }

  async postApiV1AuthLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/login", { ...init, method: "POST" });
  }

  async getApiV1AuthMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/me", { ...init, method: "GET" });
  }

  async getApiV1AuthOauthProvider(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/oauth/{provider}", { ...init, method: "GET" });
  }

  async getApiV1AuthOauthProviderCallback(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/oauth/{provider}/callback", { ...init, method: "GET" });
  }

  async getApiV1AuthTokens(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/tokens", { ...init, method: "GET" });
  }

  async postApiV1AuthTokens(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/tokens", { ...init, method: "POST" });
  }

  async deleteApiV1AuthTokensId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/auth/tokens/{id}", { ...init, method: "DELETE" });
  }

  async getApiV1Comments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/comments", { ...init, method: "GET" });
  }

  async getApiV1CommentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/comments/{id}", { ...init, method: "GET" });
  }

  async patchApiV1CommentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/comments/{id}", { ...init, method: "PATCH" });
  }

  async deleteApiV1CommentsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/comments/{id}", { ...init, method: "DELETE" });
  }

  async getApiV1Organizations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/organizations", { ...init, method: "GET" });
  }

  async postApiV1Organizations(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/organizations", { ...init, method: "POST" });
  }

  async getApiV1OrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/organizations/{id}", { ...init, method: "GET" });
  }

  async patchApiV1OrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/organizations/{id}", { ...init, method: "PATCH" });
  }

  async deleteApiV1OrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/organizations/{id}", { ...init, method: "DELETE" });
  }

  async getApiV1Projects(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/projects", { ...init, method: "GET" });
  }

  async postApiV1Projects(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/projects", { ...init, method: "POST" });
  }

  async getApiV1ProjectsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/projects/{id}", { ...init, method: "GET" });
  }

  async patchApiV1ProjectsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/projects/{id}", { ...init, method: "PATCH" });
  }

  async deleteApiV1ProjectsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/projects/{id}", { ...init, method: "DELETE" });
  }

  async getApiV1ReportsOrganizationsId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/reports/organizations/{id}", { ...init, method: "GET" });
  }

  async getApiV1ReportsSummary(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/reports/summary", { ...init, method: "GET" });
  }

  async getApiV1Search(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/search", { ...init, method: "GET" });
  }

  async getApiV1Tasks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks", { ...init, method: "GET" });
  }

  async postApiV1Tasks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks", { ...init, method: "POST" });
  }

  async getApiV1TasksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks/{id}", { ...init, method: "GET" });
  }

  async patchApiV1TasksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks/{id}", { ...init, method: "PATCH" });
  }

  async deleteApiV1TasksId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks/{id}", { ...init, method: "DELETE" });
  }

  async getApiV1TasksIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks/{id}/comments", { ...init, method: "GET" });
  }

  async postApiV1TasksIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/tasks/{id}/comments", { ...init, method: "POST" });
  }

  async getApiV1Webhooks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/webhooks", { ...init, method: "GET" });
  }

  async postApiV1Webhooks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/api/v1/webhooks", { ...init, method: "POST" });
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

}
