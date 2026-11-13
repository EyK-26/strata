export class HiroAppClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async getHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "GET" });
  }

  async headHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "HEAD" });
  }

  async postHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "POST" });
  }

  async putHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "PUT" });
  }

  async deleteHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "DELETE" });
  }

  async patchHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "PATCH" });
  }

  async optionsHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "OPTIONS" });
  }

  async traceHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "TRACE" });
  }

  async getMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "GET" });
  }

  async headMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "HEAD" });
  }

  async postMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "POST" });
  }

  async putMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "PUT" });
  }

  async deleteMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "DELETE" });
  }

  async patchMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "PATCH" });
  }

  async optionsMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "OPTIONS" });
  }

  async traceMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "TRACE" });
  }

  async getReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "GET" });
  }

  async headReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "HEAD" });
  }

  async postReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "POST" });
  }

  async putReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "PUT" });
  }

  async deleteReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "DELETE" });
  }

  async patchReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "PATCH" });
  }

  async optionsReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "OPTIONS" });
  }

  async traceReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "TRACE" });
  }

  async postAuthToken(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/token", { ...init, method: "POST" });
  }

  async getUser(init: RequestInit = {}): Promise<Response> {
    return await this.request("/user", { ...init, method: "GET" });
  }

  async headUser(init: RequestInit = {}): Promise<Response> {
    return await this.request("/user", { ...init, method: "HEAD" });
  }

  async getV1AuthCsrf(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/csrf", { ...init, method: "GET" });
  }

  async headV1AuthCsrf(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/csrf", { ...init, method: "HEAD" });
  }

  async postV1AuthForgotPassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/forgot-password", { ...init, method: "POST" });
  }

  async postV1AuthLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/login", { ...init, method: "POST" });
  }

  async postV1AuthLogout(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/logout", { ...init, method: "POST" });
  }

  async getV1AuthMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/me", { ...init, method: "GET" });
  }

  async headV1AuthMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/me", { ...init, method: "HEAD" });
  }

  async postV1AuthRegister(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/register", { ...init, method: "POST" });
  }

  async postV1AuthResetPassword(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/reset-password", { ...init, method: "POST" });
  }

  async postV1AuthVerifyEmail(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/verify-email", { ...init, method: "POST" });
  }

  async getAuthSaml(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/saml", { ...init, method: "GET" });
  }

  async headAuthSaml(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/saml", { ...init, method: "HEAD" });
  }

  async postAuthSamlAcs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/saml/acs", { ...init, method: "POST" });
  }

  async getScimV2ServiceProviderConfig(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/ServiceProviderConfig", { ...init, method: "GET" });
  }

  async headScimV2ServiceProviderConfig(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/ServiceProviderConfig", { ...init, method: "HEAD" });
  }

  async getScimV2Users(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users", { ...init, method: "GET" });
  }

  async postScimV2Users(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users", { ...init, method: "POST" });
  }

  async headScimV2Users(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users", { ...init, method: "HEAD" });
  }

  async getScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "GET" });
  }

  async putScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "PUT" });
  }

  async patchScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "PATCH" });
  }

  async deleteScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "DELETE" });
  }

  async headScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "HEAD" });
  }

}
