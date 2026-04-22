import { Hono } from "hono";
import { compress } from "hono/compress";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { securityHeaders } from "./middleware/security.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLineRoutes } from "./routes/lines.js";
import { registerStopRoutes } from "./routes/stops.js";
import { registerVehicleRoutes } from "./routes/vehicles.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerSseRoutes } from "./routes/sse.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { loadGtfsStatic } from "./gtfs/static-loader.js";
import { startRealtimePoller } from "./gtfs/realtime-poller.js";
import { initDatabase, runDeferredMigrations, runBackfillHourlyStats } from "./analytics/db.js";
import { startCollector } from "./analytics/collector.js";
import { loadCalendarContext } from "./analytics/calendar.js";

const app = new Hono();

app.use("*", corsMiddleware());
app.use("*", securityHeaders());
// Compress JSON responses — shape payloads can reach 150 KB uncompressed.
app.use("/api/*", compress());
app.use("/api/*", rateLimit());

registerHealthRoutes(app);
registerLineRoutes(app);
registerStopRoutes(app);
registerVehicleRoutes(app);
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

  // Opt-in migration for the composite indexes on delay_snapshots. Disabled
  // by default — bun:sqlite is synchronous and a CREATE INDEX on millions of
  // rows blocks every HTTP handler for the duration. Only enable during a
  // maintenance window: RUN_DEFERRED_MIGRATIONS=1.
  if (process.env["RUN_DEFERRED_MIGRATIONS"] === "1") {
    runDeferredMigrations().catch((err) => {
      logger.error({ err }, "deferred migration task failed");
    });
  }

  // One-shot backfill of hourly_stats from delay_snapshots. Same caveat:
  // it's a huge aggregation query on millions of rows and will stall the
  // main thread for its duration, so keep it behind an explicit flag.
  if (process.env["RUN_BACKFILL"] === "1") {
    runBackfillHourlyStats().catch((err) => {
      logger.error({ err }, "hourly_stats backfill failed");
    });
  }
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "bootstrap failed");
  process.exit(1);
});

export default {
  port: config.port,
  fetch: app.fetch,
};
