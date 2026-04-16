const env = process.env;

function getEnv(key: string, fallback: string): string {
  return env[key] ?? fallback;
}

function getEnvInt(key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const config = {
  port: getEnvInt("PORT", 3000),

  gtfsDatasetApiUrl: getEnv(
    "GTFS_DATASET_API_URL",
    "https://data.toulouse-metropole.fr/api/explore/v2.1/catalog/datasets/tisseo-gtfs/records?limit=1",
  ),

  // Use the transport.data.gouv.fr proxy — it delivers trip updates and alerts
  // that the direct Tisseo URL currently does not serve (their feed is in beta
  // and has been dropping tripUpdate entities).
  gtfsRtUrl: getEnv(
    "GTFS_RT_URL",
    "https://www.data.gouv.fr/api/1/datasets/r/b2343456-4e73-4e5e-bf0f-e8cab63357a8",
  ),

  gtfsRtAlertsUrl: getEnv(
    "GTFS_RT_ALERTS_URL",
    "https://www.data.gouv.fr/api/1/datasets/r/b2343456-4e73-4e5e-bf0f-e8cab63357a8",
  ),

  pollingIntervalMs: getEnvInt("POLLING_INTERVAL_MS", 10_000),
  analyticsSnapshotIntervalMs: getEnvInt("ANALYTICS_SNAPSHOT_INTERVAL_MS", 60_000),
  dataDir: getEnv("DATA_DIR", "./data"),
  nodeEnv: getEnv("NODE_ENV", "development"),

  get isDev(): boolean {
    return this.nodeEnv === "development";
  },

  get isProd(): boolean {
    return this.nodeEnv === "production";
  },
} as const;
