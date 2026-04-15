import type { MiddlewareHandler } from "hono";
import { config } from "../config.js";

const ALLOWED_ORIGINS_DEV = ["http://localhost:5173", "http://localhost:3000"];
const ALLOWED_ORIGINS_PROD = ["https://toloseo.fr", "https://www.toloseo.fr"];

function getAllowedOrigins(): string[] {
  const envOrigin = process.env["CORS_ORIGIN"];
  if (envOrigin) return envOrigin.split(",").map((o) => o.trim());
  return config.isDev ? ALLOWED_ORIGINS_DEV : ALLOWED_ORIGINS_PROD;
}

export function corsMiddleware(): MiddlewareHandler {
  const allowed = new Set(getAllowedOrigins());

  return async (c, next) => {
    const origin = c.req.header("origin") ?? "";
    const isAllowed = allowed.has(origin) || config.isDev;

    if (isAllowed) {
      c.header("Access-Control-Allow-Origin", origin || "*");
    }

    c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept, Last-Event-ID");
    c.header("Access-Control-Max-Age", "86400");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  };
}
