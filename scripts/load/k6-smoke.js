import { check, sleep } from "k6";
import http from "k6/http";

export const options = {
  vus: 5,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  check(http.get(`${baseUrl}/health`), { "health ok": (r) => r.status === 200 });
  check(http.get(`${baseUrl}/ready`), { "ready ok": (r) => r.status === 200 });
  check(http.get(`${baseUrl}/api/v1/organizations`), {
    "organizations ok": (r) => r.status === 200,
  });
  sleep(1);
}
