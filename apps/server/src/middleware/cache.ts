import type { MiddlewareHandler } from "hono";

export function cacheControl(maxAge: number, staleWhileRevalidate = 0): MiddlewareHandler {
  const directives = [`public`, `max-age=${maxAge}`];
  if (staleWhileRevalidate > 0) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }
  const value = directives.join(", ");

  return async (c, next) => {
    await next();
    if (c.res.status < 400) {
      c.header("Cache-Control", value);
    }
  };
}

export function noCache(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  };
}
