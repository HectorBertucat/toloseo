# Toloseo - CLAUDE.md

> Tolosa + Tisseo. Real-time transit visualization & analytics for Toulouse.

## CRITICAL RULES

- **NEVER commit secrets, API keys, passwords, or tokens** to the repository
- All sensitive values go in environment variables on the VPS only
- `.env` files are gitignored and must NEVER be committed
- Tisseo API key (when obtained) is server-side only, never exposed to client

## Architecture

- **Monorepo:** `apps/server` (Bun + Hono) + `apps/web` (SolidJS + Vite)
- **Shared types:** `shared/types.ts`
- **Deploy configs:** `deploy/`
- **No Docker** - systemd manages the process
- **No Redis** - in-memory store for RT data
- **SQLite** for analytics (`bun:sqlite`)

## Stack

- Runtime: Bun
- Backend: Hono framework
- Frontend: SolidJS + MapLibre GL JS + OpenFreeMap tiles
- Database: SQLite (analytics only)
- Bundler: Vite
- CSS: Vanilla CSS with variables/modules
- Deployment: Caddy (reverse proxy) + systemd + Cloudflare

## Conventions

- TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess: true`)
- ESM only (no CommonJS)
- Naming: `camelCase` vars/functions, `PascalCase` types/components, `kebab-case` files
- No `any` - use `unknown` + type guards
- Functions <= 30 lines, extract if longer
- No obvious comments - self-documenting code
- Explicit imports (no `import *` except protobufjs)
- Each route file exports a function that takes Hono app and registers routes
- SolidJS: functional components, stores separated, no business logic in components

## Data Sources

- GTFS Static: `https://data.toulouse-metropole.fr/explore/dataset/tisseo-gtfs/files/`
- GTFS-RT: `https://api.tisseo.fr/opendata/gtfsrt/GtfsRt.pb` (no key needed)
- GTFS-RT Alerts: `https://api.tisseo.fr/opendata/gtfsrt/Alert.pb`
- Calendar: data.gouv.fr (school holidays zone C)

## Production

- URL: https://toloseo.hectorb.fr
- Server: Hetzner VPS (Ubuntu 24.04)
- Access: Cloudflare Tunnel (no ports exposed, IP not public)
- Deploy path: `/opt/toloseo/`
- Process: systemd service `toloseo` (port 3001)
- Caddy: port 8080 (reverse proxy + static files)
- Tunnel: systemd service `cloudflared-toloseo`
- User: `deploy` (non-root)

## CI/CD

- GitHub Actions: SSH + rsync to VPS
- Secrets required in GitHub Actions (NOT in code):
  - `VPS_HOST` - VPS IP address
  - `VPS_SSH_KEY` - SSH private key for deploy user
  - `VPS_USER` - deploy username

## Commands

```bash
# Development (from project root)
cd apps/server && bun run dev     # Backend dev server
cd apps/web && bun run dev        # Frontend dev server

# Build
cd apps/web && bun run build      # Build frontend

# Deploy (automated via GitHub Actions on push to main)
```
