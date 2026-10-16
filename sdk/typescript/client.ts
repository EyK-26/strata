export class HiroAppClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async postAuthToken(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/token", { ...init, method: "POST" });
  }

  async getUser(init: RequestInit = {}): Promise<Response> {
    return await this.request("/user", { ...init, method: "GET" });
  }

  async getV1AuthCsrf(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/csrf", { ...init, method: "GET" });
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

  async postAuthSamlAcs(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/saml/acs", { ...init, method: "POST" });
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

  async putScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "PUT" });
  }

  async patchScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "PATCH" });
  }

  async deleteScimV2UsersId(init: RequestInit = {}): Promise<Response> {
    return await this.request("/scim/v2/Users/{id}", { ...init, method: "DELETE" });
  }

}
