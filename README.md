# Toloseo

> Tolosa + Tisseo — Real-time visualization and analytics for Toulouse's transit network.

Toloseo is a PWA that shows Toulouse's public transport (metro, tram, bus, Lineo, Teleo cable car) in real-time on an interactive map, with a unique analytics layer: average delays, reliability scores, and temporal trends.

## Features

- **Live map** — Vehicles moving in real-time on route shapes, color-coded by delay
- **Departure board** — Full-screen LED-style display for any stop
- **Line selector** — Browse all 125+ lines, grouped by mode, with live stats
- **Analytics** — Delay history, reliability scores, weekly trends
- **Dark/light mode** — Map and UI adapt to your preference
- **PWA** — Install on your phone, works offline with cached data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Bun + Hono |
| Frontend | SolidJS + MapLibre GL JS |
| Map tiles | OpenFreeMap |
| Database | SQLite (analytics) |
| Real-time | Server-Sent Events |
| Deploy | Caddy + systemd + Cloudflare |

## Data Sources

- **GTFS Static** — Toulouse Metropole open data (ODbL)
- **GTFS-RT** — Tisseo real-time feed (protobuf, no API key needed)

## Development

```bash
# Install dependencies
cd apps/server && bun install
cd apps/web && bun install

# Run backend (port 3000)
cd apps/server && bun run dev

# Run frontend (port 5173, proxies /api to backend)
cd apps/web && bun run dev
```

## Architecture

```
Client -> Cloudflare -> Caddy -> Bun/Hono (API) + Static files (SPA)
                                      |
                        GTFS-RT Poller (10s) -> In-memory store
                        Analytics Worker (1min) -> SQLite
```

## License

MIT - See [LICENSE](LICENSE)

**Data:** ODbL - Tisseo / Toulouse Metropole
**Map tiles:** OpenFreeMap - OpenMapTiles, data OpenStreetMap contributors
