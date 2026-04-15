import type { MiddlewareHandler } from "hono";

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-XSS-Protection", "0");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.openfreemap.org; connect-src 'self' https://*.openfreemap.org",
    );
    c.header(
      "Permissions-Policy",
      "geolocation=(self), camera=(), microphone=()",
    );

    await next();
  };
}
