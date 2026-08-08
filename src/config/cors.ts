interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}

const corsConfig: CorsConfig = {
  allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  allowedMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "X-Request-Id",
    "X-Authenticated-User-Id",
    "X-Authenticated-User-Role",
  ],
  maxAgeSeconds: 86_400,
};

export type { CorsConfig };
export { corsConfig };
