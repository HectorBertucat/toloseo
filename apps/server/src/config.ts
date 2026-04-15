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

  gtfsRtUrl: getEnv(
    "GTFS_RT_URL",
    "https://api.tisseo.fr/opendata/gtfsrt/GtfsRt.pb",
  ),

  gtfsRtAlertsUrl: getEnv(
    "GTFS_RT_ALERTS_URL",
    "https://api.tisseo.fr/opendata/gtfsrt/Alert.pb",
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
