import { Hono } from "hono";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { securityHeaders } from "./middleware/security.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLineRoutes } from "./routes/lines.js";
import { registerStopRoutes } from "./routes/stops.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerSseRoutes } from "./routes/sse.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { loadGtfsStatic } from "./gtfs/static-loader.js";
import { startRealtimePoller } from "./gtfs/realtime-poller.js";
import { initDatabase } from "./analytics/db.js";
import { startCollector } from "./analytics/collector.js";
import { loadCalendarContext } from "./analytics/calendar.js";

const app = new Hono();

app.use("*", corsMiddleware());
app.use("*", securityHeaders());
app.use("/api/*", rateLimit());

registerHealthRoutes(app);
registerLineRoutes(app);
registerStopRoutes(app);
registerAlertRoutes(app);
registerSseRoutes(app);
registerAnalyticsRoutes(app);

app.notFound((c) => {
  return c.json({ ok: false, error: "Not found", timestamp: Date.now() }, 404);
});

app.onError((err, c) => {
  logger.error({ err: err.message, path: c.req.path }, "unhandled error");
  return c.json(
    { ok: false, error: "Internal server error", timestamp: Date.now() },
    500,
  );
});

async function bootstrap(): Promise<void> {
  await initDatabase();
  await loadCalendarContext();

  loadGtfsStatic().catch((err) => {
    logger.error({ err }, "GTFS static load failed - will retry on next start");
  });

  startRealtimePoller();
  startCollector();

  logger.info(
    { port: config.port, env: config.nodeEnv },
    "toloseo server started",
  );
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "bootstrap failed");
  process.exit(1);
});

export default {
  port: config.port,
  fetch: app.fetch,
};
