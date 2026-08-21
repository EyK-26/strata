import { fetchPageText } from "../src/testing/webViewSmoke.ts";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const text = await fetchPageText({ url: `${BASE_URL}/health` });

if (!text.toLowerCase().includes("ok")) {
  throw new Error(
    `WebView smoke failed: /health did not contain "ok" (got: ${text.slice(0, 120)})`,
  );
}

console.log(`WebView smoke passed against ${BASE_URL}/health`);
