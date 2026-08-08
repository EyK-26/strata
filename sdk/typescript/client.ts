export class WorkHubClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api/v1") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async getAuditLogs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/audit-logs", { ...init, method: "GET" });
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

  async getAuthTokens(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/tokens", { ...init, method: "GET" });
  }

  async postAuthTokens(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/tokens", { ...init, method: "POST" });
  }

  async deleteAuthTokensId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/tokens/{id}", { ...init, method: "DELETE" });
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

  async getTasksIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}/comments", { ...init, method: "GET" });
  }

  async postTasksIdComments(init: RequestInit = {}): Promise<Response> {
    return await this.request("/tasks/{id}/comments", { ...init, method: "POST" });
  }

  async getWebhooks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks", { ...init, method: "GET" });
  }

  async postWebhooks(init: RequestInit = {}): Promise<Response> {
    return await this.request("/webhooks", { ...init, method: "POST" });
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
