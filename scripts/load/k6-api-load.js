import { check, sleep } from "k6";
import http from "k6/http";

export const options = {
  vus: 10,
  duration: "45s",
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<750"],
  },
};

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";
const adminToken = __ENV.ADMIN_API_TOKEN || "workhub-admin-test-token";

export function setup() {
  const loginResponse = http.post(
    `${baseUrl}/api/v1/auth/login`,
    JSON.stringify({
      email: "admin@workhub.test",
      password: "password",
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );

  check(loginResponse, {
    "login ok": (response) => response.status === 201,
  });

  const loginBody = loginResponse.json();

  return {
    token: loginBody?.token ?? adminToken,
  };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
  };

  check(http.get(`${baseUrl}/health`), { "health ok": (response) => response.status === 200 });
  check(http.get(`${baseUrl}/ready`), { "ready ok": (response) => response.status === 200 });

  const organizations = http.get(`${baseUrl}/api/v1/organizations`, { headers });
  check(organizations, {
    "organizations ok": (response) => response.status === 200,
  });

  const projects = http.get(`${baseUrl}/api/v1/projects`, { headers });
  check(projects, {
    "projects ok": (response) => response.status === 200,
  });

  sleep(0.5);
}
