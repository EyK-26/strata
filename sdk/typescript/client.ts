export class HiroAppClient {
  constructor(private readonly baseUrl = "http://localhost:3000/api") {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${this.baseUrl}${path}`, init);
  }

  async get(init: RequestInit = {}): Promise<Response> {
    return await this.request("/", { ...init, method: "GET" });
  }

  async postAuthToken(init: RequestInit = {}): Promise<Response> {
    return await this.request("/auth/token", { ...init, method: "POST" });
  }

  async getUser(init: RequestInit = {}): Promise<Response> {
    return await this.request("/user", { ...init, method: "GET" });
  }

  async postV1AuthLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/login", { ...init, method: "POST" });
  }

  async getV1AuthMe(init: RequestInit = {}): Promise<Response> {
    return await this.request("/v1/auth/me", { ...init, method: "GET" });
  }

  async getHealth(init: RequestInit = {}): Promise<Response> {
    return await this.request("/health", { ...init, method: "GET" });
  }

  async getLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/login", { ...init, method: "GET" });
  }

  async postLogin(init: RequestInit = {}): Promise<Response> {
    return await this.request("/login", { ...init, method: "POST" });
  }

  async postLogout(init: RequestInit = {}): Promise<Response> {
    return await this.request("/logout", { ...init, method: "POST" });
  }

  async getMetrics(init: RequestInit = {}): Promise<Response> {
    return await this.request("/metrics", { ...init, method: "GET" });
  }

  async getReady(init: RequestInit = {}): Promise<Response> {
    return await this.request("/ready", { ...init, method: "GET" });
  }

}
