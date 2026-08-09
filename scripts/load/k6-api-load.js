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

export function setup() {
  const loginResponse = http.post(
    `${baseUrl}/api/auth/token`,
    JSON.stringify({
      email: "demo@example.com",
      password: "password",
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );

  check(loginResponse, {
    "jwt mint ok": (response) => response.status === 200,
  });

  const loginBody = loginResponse.json();

  return {
    token: loginBody?.token ?? "",
  };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
  };

  check(http.get(`${baseUrl}/health`), { "health ok": (response) => response.status === 200 });
  check(http.get(`${baseUrl}/ready`), { "ready ok": (response) => response.status === 200 });
  check(http.get(`${baseUrl}/login`), { "login ok": (response) => response.status === 200 });
  check(http.get(`${baseUrl}/api/user`, { headers }), {
    "current user ok": (response) => response.status === 200,
  });

  sleep(0.5);
}
