# PRD — Toloseo

> Tolosa + Tisséo. Visualisation temps réel et analytics du réseau de transport toulousain.

---

## 1. Vision & Positionnement

**Toloseo** est une application web PWA de visualisation temps réel du réseau Tisséo (métro, tram, bus, Linéo, téléphérique Téléo) avec une couche analytics unique : historique des retards, fiabilité par ligne, tendances temporelles.

### Ce qui existe déjà

- **bus-tracker.fr** — tracker multi-réseaux France (GPL-3.0), couvre Toulouse. Vue carte avec marqueurs véhicules, fonctionnel mais générique et sans mémoire.
- **App officielle Tisséo** — achat de titres, prochains passages, plan interactif. Pas d'analytics, pas de vue "observatoire".
- **Moovit / Transit** — apps commerciales multi-villes, pas de données historiques ouvertes.

### Ce que Toloseo fait différemment

| Axe | bus-tracker.fr | App Tisséo | **Toloseo** |
|-----|---------------|------------|-------------|
| Scope | France entière, générique | Toulouse, orienté voyageur | Toulouse, orienté data/observatoire |
| Temps réel | Oui (marqueurs basiques) | Oui (prochains passages) | Oui (carte animée + departure board) |
| Historique & analytics | Non | Non | **Oui** — retards moyens, fiabilité, tendances |
| UI/UX | Fonctionnel | Correcte | **Premium** — dark mode, animations fluides, Toulouse-native |
| PWA / Offline | Non | App native | **Oui** — horaires théoriques offline, arrêts proches |
| Departure board | Non | Non | **Oui** — vue plein écran type afficheur gare |
| Open source | Oui (GPL-3) | Non | **Oui** (MIT) |

**En résumé :** Toloseo est à mi-chemin entre un tracker temps réel et un observatoire de la performance du réseau. C'est un projet vitrine qui montre des compétences en data engineering (collecte, stockage, agrégation), en architecture backend performante, et en frontend moderne.

---

## 2. Sources de données

### 2.1 GTFS Statique (batch — quotidien)

- **URL :** `https://data.toulouse-metropole.fr/explore/dataset/tisseo-gtfs/files/.../download/`
- **Contenu :** 125 lignes, 3 820 arrêts, 36 261 trajets avec shapes (tracés géographiques)
- **Fichiers clés :** `routes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`, `shapes.txt`, `calendar.txt`, `calendar_dates.txt`, `transfers.txt`
- **Fréquence :** Publié chaque jour à 4h15. Horizon 3 semaines.
- **Licence :** ODbL
- **Qualité :** 16 avertissements mineurs (temps de trajet nuls entre certains arrêts proches). Globalement fiable.

### 2.2 GTFS-RT (temps réel — sans clé)

- **URL complète :** `https://api.tisseo.fr/opendata/gtfsrt/GtfsRt.pb` (protobuf) / `GtfsRt.json` (JSON)
- **URL alertes :** `https://api.tisseo.fr/opendata/gtfsrt/Alert.pb` / `Alert.json`
- **Fréquence source :** ~5 secondes
- **Profondeur temporelle :** 2 heures
- **Contenu confirmé :**
  - `TripUpdate` — retards/avances par arrêt (bus, tram, téléphérique)
  - `Alert` — perturbations réseau
- **VehiclePosition :** Probablement absent. Le back vérifie au premier polling. Si absent → interpolation sur le shape à partir des horaires théoriques + delay connu.
- **Gestion ETag :** Header `If-None-Match` pour éviter les re-téléchargements inutiles.
- **⚠️ Beta :** Tisséo signale des instabilités possibles. Le back doit gérer les erreurs gracieusement.

### 2.3 API REST Tisséo v2 (nice-to-have — nécessite clé)

- **Clé :** Gratuite, demandée à opendata@tisseo.fr (en attente)
- **Services utiles :** `departures`, `lines`, `stop_points`, `messages`
- **Usage :** Enrichissement optionnel (prochains passages formatés, recherche de lieux). Pas critique pour le MVP.
- **CORS :** Supporté. Mais on passe toujours par le back pour ne pas exposer la clé.

### 2.4 Données complémentaires (analytics)

- **Calendrier scolaire académie de Toulouse** — data.gouv.fr, fichier annuel
- **Jours fériés français** — table statique embarquée dans le code
- **Vacances zone C** — data.gouv.fr

---

## 3. Architecture technique

### 3.1 Vue d'ensemble

```
                              ┌─────────────────────────────┐
                              │        Cloudflare           │
                              │   (proxy, cache, WAF, DNS)  │
                              └──────────┬──────────────────┘
                                         │ HTTPS
                              ┌──────────▼──────────────────┐
                              │         Caddy               │
                              │  (reverse proxy, TLS, gzip) │
                              └──────────┬──────────────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     │                                       │
          ┌──────────▼──────────┐             ┌──────────────▼──────┐
          │   Bun + Hono (API)  │             │  Static files (SPA) │
          │   port 3000         │             │  /dist (Vite build)  │
          └──────────┬──────────┘             └─────────────────────┘
                     │
        ┌────────────┼────────────────┐
        │            │                │
   ┌────▼────┐  ┌────▼─────┐  ┌──────▼──────┐
   │ Poller  │  │ Analytics │  │ In-memory   │
   │ GTFS-RT │  │  Worker   │  │   Store     │
   │ (10s)   │  │ (1min)    │  │ (Map/Object)│
   └────┬────┘  └────┬──────┘  └─────────────┘
        │            │
   ┌────▼────┐  ┌────▼──────┐
   │ Tisséo  │  │  SQLite   │
   │ GTFS-RT │  │ analytics │
   │ (open)  │  │  (~50Mo)  │
   └─────────┘  └───────────┘
```

### 3.2 Stack technique

#### Backend

| Composant | Choix | Justification |
|-----------|-------|---------------|
| Runtime | **Bun** | Perf I/O, TypeScript natif, startup rapide |
| Framework HTTP | **Hono** | ~14kB, SSE natif (`streamSSE`), typé, multiplateforme |
| Parsing GTFS-RT | **protobufjs** + `gtfs-realtime-bindings` | Standard officiel Google |
| Parsing GTFS statique | **csv-parse** (streaming) | Parse les gros CSV sans tout charger en RAM |
| Store temps réel | **Map/Object natif** | ~3 800 arrêts, ~125 lignes → tient en mémoire |
| Store analytics | **SQLite** (via `bun:sqlite`) | Natif dans Bun, zero dependency, ~50 Mo sur disque |
| Scheduler | **setInterval** (Bun natif) | Polling GTFS-RT (10s), snapshot analytics (1min) |
| Validation | **Zod** | Validation query params, typage runtime |
| Logging | **pino** | JSON structuré, performant |

#### Frontend

| Composant | Choix | Justification |
|-----------|-------|---------------|
| Framework | **SolidJS** | Réactivité fine-grained, ~7kB, pas de virtual DOM, idéal pour updates fréquentes |
| Carte | **MapLibre GL JS** | WebGL, open source, vector tiles, pas de clé API |
| Tuiles de fond | **OpenFreeMap** | Gratuit, sans clé, sans quota, sans cookies |
| Bundler | **Vite** | HMR rapide, tree-shaking, code splitting natif |
| CSS | **Vanilla CSS** (variables + modules) | Contrôle total, pas de runtime CSS-in-JS |
| Icônes | **Lucide** (subset tree-shakeable) | Léger, cohérent |
| PWA | **vite-plugin-pwa** + **Workbox** | Service worker, cache offline, manifest |
| Graphiques analytics | **Lightweight charts** ou **uPlot** | Ultra-léger (~40kB), performant pour séries temporelles |

#### Infrastructure

| Composant | Choix | Justification |
|-----------|-------|---------------|
| Serveur | Hetzner VPS (4 vCPU, 8 Go RAM, 80 Go SSD) | Largement suffisant |
| OS | Ubuntu 24.04 | Stable |
| Process manager | **systemd** | Natif, fiable, auto-restart |
| Reverse proxy | **Caddy** | HTTPS auto, HTTP/2, brotli, config minimale |
| CDN / Proxy | **Cloudflare** (free plan) | Cache, WAF, masquage IP, DDoS protection |
| DNS | **Cloudflare** | CNAME proxy (orange cloud) vers le VPS |
| CI/CD | **GitHub Actions** → `ssh + rsync` | Simple, efficace |
| Domaine | `toloseo.<ton-domaine>` | Sous-domaine CNAME |

### 3.3 Sécurité réseau (Cloudflare + Caddy)

```
[Client] → Cloudflare (IP Cloudflare publique)
                │ TLS terminé par Cloudflare
                │ Re-chiffré vers le VPS (Full Strict)
                ▼
[VPS] Caddy (bind 0.0.0.0:443, mais UFW n'autorise que les IP Cloudflare)
```

**Configuration :**
- **UFW :** Ports 80/443 ouverts uniquement pour les ranges IP Cloudflare (liste sur `cloudflare.com/ips/`)
- **SSH :** Port custom, clé uniquement, pas de password
- **Caddy :** TLS avec cert auto-signé ou origin cert Cloudflare
- **Cloudflare SSL :** Mode "Full (Strict)"
- **Cloudflare WAF :** Règles de base activées (free tier)
- **Headers Caddy :** CSP strict, HSTS, X-Frame-Options DENY, etc.

### 3.4 Pourquoi PAS certains choix

- **Pas de WebSocket** — SSE suffit (unidirectionnel serveur→client), auto-reconnexion native dans le navigateur, traverse les proxies sans souci
- **Pas de React/Next.js** — SolidJS plus performant pour des updates très fréquentes. Signal fort sur un CV.
- **Pas de PostgreSQL/DuckDB** — SQLite suffit pour l'analytics (write once, read many). Zéro config, zéro process séparé.
- **Pas de Docker** — Un seul service sur un VPS unique. systemd gère le lifecycle. Docker ajouterait de la complexité sans valeur ici.
- **Pas de Redis** — Les données RT tiennent en mémoire (~50 Mo). Pas besoin d'un cache distribué.

---

## 4. Structure du projet

```
toloseo/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts                # Point d'entrée Hono
│   │   │   ├── config.ts               # Env vars, constantes
│   │   │   │
│   │   │   ├── gtfs/
│   │   │   │   ├── static-loader.ts     # Download + parse GTFS ZIP → mémoire
│   │   │   │   ├── realtime-poller.ts   # Polling GTFS-RT (10s) + parse protobuf
│   │   │   │   ├── store.ts             # Store in-memory (routes, stops, trips, shapes, RT)
│   │   │   │   └── interpolator.ts      # Position véhicule interpolée sur le shape
│   │   │   │
│   │   │   ├── analytics/
│   │   │   │   ├── collector.ts         # Snapshot RT → SQLite (1/min)
│   │   │   │   ├── db.ts               # Schema SQLite + migrations
│   │   │   │   ├── aggregator.ts        # Requêtes d'agrégation (retard moyen, fiabilité, etc.)
│   │   │   │   └── calendar.ts          # Jours fériés, vacances zone C, jours types
│   │   │   │
│   │   │   ├── routes/
│   │   │   │   ├── sse.ts               # GET /api/stream?bbox=...
│   │   │   │   ├── lines.ts             # GET /api/lines, GET /api/lines/:id/shape
│   │   │   │   ├── stops.ts             # GET /api/stops?bbox=..., GET /api/stops/:id/departures
│   │   │   │   ├── alerts.ts            # GET /api/alerts
│   │   │   │   ├── analytics.ts         # GET /api/analytics/... (retards, fiabilité, tendances)
│   │   │   │   └── health.ts            # GET /api/health
│   │   │   │
│   │   │   ├── middleware/
│   │   │   │   ├── cache.ts             # Cache-Control headers
│   │   │   │   ├── cors.ts              # CORS (origines explicites)
│   │   │   │   ├── rate-limit.ts        # 60 req/min par IP, 5 SSE simultanés
│   │   │   │   └── security.ts          # Security headers
│   │   │   │
│   │   │   └── utils/
│   │   │       ├── etag.ts              # Gestion ETag appels Tisséo
│   │   │       ├── geo.ts               # Helpers bbox, distance, point-on-line
│   │   │       └── time.ts              # Parse GTFS time (25:30:00 → demain 01:30)
│   │   │
│   │   ├── data/
│   │   │   └── toloseo.db              # SQLite analytics (gitignored)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/
│       ├── src/
│       │   ├── index.tsx
│       │   ├── App.tsx                  # Layout principal (carte + overlays)
│       │   │
│       │   ├── components/
│       │   │   ├── map/
│       │   │   │   ├── TransitMap.tsx         # Composant MapLibre principal
│       │   │   │   ├── LineLayer.tsx           # Tracés de lignes GeoJSON
│       │   │   │   ├── StopMarkers.tsx         # Marqueurs arrêts (clustérisés)
│       │   │   │   ├── VehicleMarkers.tsx      # Marqueurs véhicules animés
│       │   │   │   └── StopPopup.tsx           # Popup au clic sur un arrêt
│       │   │   │
│       │   │   ├── panels/
│       │   │   │   ├── LineSelector.tsx         # Sidebar desktop / bottom sheet mobile
│       │   │   │   ├── DepartureBoard.tsx       # Vue "afficheur gare" plein écran
│       │   │   │   ├── AlertBanner.tsx          # Bandeau alertes en haut
│       │   │   │   └── NetworkStats.tsx         # Widget stats réseau overlay
│       │   │   │
│       │   │   ├── analytics/
│       │   │   │   ├── DelayChart.tsx           # Graphique retard moyen par heure
│       │   │   │   ├── ReliabilityCard.tsx      # Score de fiabilité par ligne
│       │   │   │   └── TrendBadge.tsx           # Badge tendance (↑↓ vs semaine précédente)
│       │   │   │
│       │   │   └── ui/
│       │   │       ├── ThemeToggle.tsx
│       │   │       ├── ModeIcon.tsx             # Icône par mode (metro, tram, bus, cable)
│       │   │       └── Skeleton.tsx             # Loading states
│       │   │
│       │   ├── stores/
│       │   │   ├── transit.ts                  # Store réactif données RT
│       │   │   ├── analytics.ts                # Store données analytics
│       │   │   └── ui.ts                       # UI state (ligne sélectionnée, vue, theme)
│       │   │
│       │   ├── services/
│       │   │   ├── sse-client.ts               # EventSource + reconnexion + exponential backoff
│       │   │   └── api.ts                      # Fetch wrapper typé vers le back
│       │   │
│       │   ├── utils/
│       │   │   ├── geo.ts
│       │   │   ├── format.ts                   # Formatage heures, durées, retards
│       │   │   └── tisseo-colors.ts            # Map route_id → couleur officielle
│       │   │
│       │   └── styles/
│       │       ├── variables.css
│       │       ├── global.css
│       │       └── components/
│       │
│       ├── public/
│       │   ├── favicon.svg
│       │   ├── og-image.png
│       │   └── manifest.json                   # PWA manifest
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── shared/
│   └── types.ts                                # Types partagés back/front
│
├── deploy/
│   ├── Caddyfile
│   ├── toloseo.service                         # systemd unit
│   ├── ufw-cloudflare.sh                       # Script setup firewall
│   └── setup.sh                                # Script premier déploiement
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── README.md
├── LICENSE                                      # MIT
└── .gitignore
```

---

## 5. Fonctionnalités

### 5.1 Vue Carte (vue principale)

- **Fond de carte :** OpenFreeMap, style sombre par défaut, toggle clair
- **Tracés de lignes :** GeoJSON depuis shapes.txt, colorés par `route_color` officiel Tisséo
- **Arrêts :** Marqueurs avec clustering automatique (MapLibre natif) à faible zoom. Taille/icône différenciée par mode : ● métro (gros), ◆ tram, ▲ Téléo, • bus/Linéo
- **Véhicules :** Marqueurs animés se déplaçant sur le tracé. Couleur = couleur de la ligne. Flèche de direction. Animation fluide via `requestAnimationFrame` entre deux updates SSE.
- **Retards visuels :** Halo vert (à l'heure) / orange (retard < 5min) / rouge (retard ≥ 5min) autour des véhicules et arrêts
- **Viewport-aware :** Le back filtre les données SSE par bbox du client (debounce 300ms)
- **Géolocalisation :** Bouton "ma position" pour centrer la carte et montrer les arrêts proches

### 5.2 Sélecteur de lignes

- **Desktop :** Sidebar gauche, 320px, repliable
- **Mobile :** Bottom sheet, swipeable, 3 états (collapsed / half / full)
- **Groupé par mode :** Métro → Tram → Téléphérique → Linéo → Bus
- **Par ligne :** Numéro, nom, couleur, icône mode + **indicateurs live** :
  - Nombre de véhicules actifs
  - Retard moyen actuel
  - Badge tendance vs semaine précédente (↑ pire / ↓ mieux / = stable)
  - Pastille fiabilité (% à l'heure sur les 7 derniers jours)
- **Recherche :** Filtrage texte instantané
- **Clic :** Zoom sur le tracé, affichage véhicules + arrêts de la ligne

### 5.3 Popup arrêt

- Au clic sur un arrêt : panneau avec prochains départs
- Pour chaque départ : ligne (couleur + numéro), direction, heure théorique, retard, heure estimée
- Icône accessibilité PMR si renseigné dans stops.txt
- Lien "voir en mode departure board"

### 5.4 Departure Board (vue dédiée)

- **Route :** `/board/:stopId` ou `/board` (arrêt le plus proche)
- **Design :** Inspiration écrans LED des stations Tisséo. Fond noir, texte haute lisibilité, taille grande.
- **Contenu :** Prochains passages en temps réel, regroupés par ligne/direction. Mise à jour fluide.
- **Usage :** Pensé pour être affiché en plein écran sur une tablette dans un hall, ou sur un écran secondaire.
- **Responsive :** Fonctionne aussi sur mobile (scrollable).

### 5.5 Alertes réseau

- **Bandeau sticky** en haut de la carte : nombre d'alertes actives, résumé court
- **Clic :** Panel déroulant avec détail de chaque alerte (cause, effet, lignes/arrêts impactés, période)
- **Couleur :** Jaune (info), orange (perturbation modérée), rouge (interruption)

### 5.6 Analytics (vue dédiée)

- **Route :** `/analytics` ou panneau dans la sidebar
- **Métriques affichées :**
  - **Retard moyen par ligne** — graphique en barres horizontales, triées
  - **Fiabilité par ligne** — % de trajets à l'heure (seuil : ≤ 2min de retard), sur 7j / 30j
  - **Heatmap temporelle** — retard moyen par heure (6h–23h) × jour de la semaine, pour une ligne donnée
  - **Tendance hebdomadaire** — évolution du retard moyen cette semaine vs la précédente
  - **Impact vacances** — badge "période scolaire" / "vacances" avec comparaison
- **Important :** Les données sont présentées factuellement. Pas de "score" composite inventé ni de classement moralisateur. On montre les chiffres, l'utilisateur interprète. Le ton est celui d'un observatoire, pas d'un audit.

### 5.7 PWA & Offline

- **Service worker :** Cache des assets statiques + GTFS statique (stops, routes, shapes)
- **Offline :** Carte de base (OpenFreeMap cache les tuiles déjà visitées), arrêts proches, horaires théoriques. Bandeau "mode hors ligne" quand pas de connexion.
- **Install prompt :** Manifest PWA complet (icônes, splash screen, orientation)
- **Raccourci :** "Ajouter à l'écran d'accueil" → ouvre directement sur la carte centrée sur la dernière position

### 5.8 Dark / Light mode

- Toggle dans le header
- Change le style MapLibre (OpenFreeMap dark/light) + variables CSS
- Persisté en `localStorage`
- Respecte `prefers-color-scheme` par défaut

---

## 6. Moteur Analytics (détail)

### 6.1 Collecte (collector.ts)

Toutes les **60 secondes**, le worker prend un snapshot des TripUpdates en mémoire et insère dans SQLite :

```sql
CREATE TABLE delay_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at INTEGER NOT NULL,          -- unix timestamp
  route_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  scheduled_arrival INTEGER,             -- unix timestamp
  actual_arrival INTEGER,                -- unix timestamp (scheduled + delay)
  delay_seconds INTEGER NOT NULL,        -- delay en secondes (négatif = en avance)
  day_type TEXT NOT NULL                 -- 'weekday', 'saturday', 'sunday', 'holiday', 'vacation'
);

CREATE INDEX idx_snapshots_route_time ON delay_snapshots(route_id, captured_at);
CREATE INDEX idx_snapshots_captured ON delay_snapshots(captured_at);
```

### 6.2 Agrégation (aggregator.ts)

Requêtes SQLite pré-calculées, servies par des endpoints REST avec cache de 5 minutes :

- `GET /api/analytics/lines/:id/delay?period=7d` — retard moyen par heure de la journée
- `GET /api/analytics/lines/:id/reliability?period=30d` — % à l'heure
- `GET /api/analytics/summary` — top 5 lignes les plus/moins fiables
- `GET /api/analytics/trend?period=7d` — comparaison avec la semaine précédente

### 6.3 Rétention & Nettoyage

- **Rétention :** 90 jours de données brutes
- **Cron quotidien (3h du matin) :** `DELETE FROM delay_snapshots WHERE captured_at < unixepoch() - 90*86400`
- **Taille estimée :** ~125 lignes × ~100 trips actifs × 1 snapshot/min × 18h/jour × 90 jours ≈ ~40 Mo
- **Impact RAM :** SQLite en mode WAL, quasi nul. Les lectures n'interfèrent pas avec l'écriture.

### 6.4 Calendrier & contexte

```sql
CREATE TABLE calendar_context (
  date TEXT PRIMARY KEY,          -- 'YYYY-MM-DD'
  day_type TEXT NOT NULL,         -- 'weekday', 'saturday', 'sunday'
  is_holiday BOOLEAN DEFAULT 0,
  is_vacation BOOLEAN DEFAULT 0,
  vacation_name TEXT              -- 'Toussaint', 'Noël', etc.
);
```

Pré-rempli au démarrage avec les données data.gouv.fr (calendrier scolaire zone C + jours fériés).

---

## 7. Flux de données

### 7.1 Démarrage du serveur

1. Télécharger le ZIP GTFS statique → parser en mémoire
2. Construire les GeoJSON des shapes (une fois, gardé en mémoire)
3. Initialiser SQLite (créer tables si nécessaire, charger calendrier)
4. Démarrer le polling GTFS-RT (toutes les 10s)
5. Démarrer le collector analytics (toutes les 60s)
6. Ouvrir le serveur HTTP

### 7.2 Polling GTFS-RT (10 secondes)

```
1. GET GtfsRt.pb (ou .json) avec If-None-Match: <etag>
2. Si 304 → skip
3. Parser FeedMessage
4. Vérifier si VehiclePosition existe (premier appel uniquement)
5. Mettre à jour le store en mémoire (TripUpdates, Alerts)
6. Calculer les positions interpolées des véhicules actifs
7. Calculer le delta vs état précédent
8. Diffuser le delta à tous les clients SSE (filtré par bbox)
```

### 7.3 Connexion SSE

```
Client → GET /api/stream?bbox=1.38,43.55,1.52,43.65
  ← event: init        { lines, vehicles, alerts } (état complet du viewport)
  ← event: vehicles    { updates[] }                (delta toutes les ~10s)
  ← event: alert       { alert }                    (nouvelle/fin d'alerte)
  ← event: heartbeat   {}                           (toutes les 30s)
```

Quand le viewport change, le client fait un `POST /api/stream/viewport` avec le nouveau bbox (ou ferme/rouvre le SSE — à évaluer selon la perf).

### 7.4 Endpoints REST

| Méthode | Route | Description | Cache |
|---------|-------|-------------|-------|
| GET | `/api/lines` | Toutes les lignes + métadonnées + stats live | 30s |
| GET | `/api/lines/:id/shape` | GeoJSON du tracé | 1h |
| GET | `/api/stops?bbox=...` | Arrêts dans le viewport | 5min |
| GET | `/api/stops/:id/departures` | Prochains départs temps réel | no-cache |
| GET | `/api/stream?bbox=...` | SSE stream temps réel | no-cache |
| GET | `/api/alerts` | Alertes actives | no-cache |
| GET | `/api/stats` | Stats réseau agrégées (live) | 10s |
| GET | `/api/analytics/lines/:id/delay` | Retard moyen par heure | 5min |
| GET | `/api/analytics/lines/:id/reliability` | Score fiabilité | 5min |
| GET | `/api/analytics/summary` | Top lignes fiabilité | 5min |
| GET | `/api/analytics/trend` | Tendance hebdo | 5min |
| GET | `/api/health` | Healthcheck | no-cache |

---

## 8. Performances

### Backend
- **Polling ETag :** Ne re-télécharge le feed que si modifié
- **Protobuf parsé une seule fois** côté serveur
- **SSE delta-only :** Seules les données changées sont poussées
- **GeoJSON pré-calculé :** Shapes convertis une fois au démarrage
- **Filtrage spatial simple :** Test bbox en O(1) par véhicule, pas de lib SIG
- **SQLite WAL mode :** Écritures non-bloquantes pour les lectures

### Frontend
- **Lazy loading :** Shapes chargés uniquement pour la ligne sélectionnée/visible
- **Clustering arrêts :** MapLibre natif, performant même avec 3 800 points
- **requestAnimationFrame :** Interpolation fluide des marqueurs véhicules
- **Debounce viewport :** 300ms avant de notifier le serveur d'un changement de vue
- **Code splitting :** Vite split `/board` et `/analytics` en chunks séparés
- **System font stack :** Zéro téléchargement de police
- **Preconnect :** `<link rel="preconnect">` vers API + OpenFreeMap

### Réseau
- **HTTP/2** via Caddy (multiplexage)
- **Brotli** via Cloudflare
- **Cache Cloudflare :** Assets statiques (immutable, 1 an), endpoints cachés (TTL court)
- **Cache-Control strict** par endpoint

---

## 9. Sécurité

- **Pas d'auth** — app publique, lecture seule
- **Rate limiting :** 60 req/min par IP (REST), 5 SSE simultanés par IP
- **Cloudflare WAF :** Règles de base (free tier)
- **UFW :** Ports 80/443 uniquement pour les ranges IP Cloudflare
- **Security headers (Caddy) :**
  - `Content-Security-Policy: default-src 'self'; connect-src 'self' https://tiles.openfreemap.org; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- **Pas de cookies, pas de tracking, pas de données personnelles**
- **Input validation :** Zod sur tous les query params
- **Clé API Tisséo :** Jamais exposée au client

---

## 10. UI/UX — Design System

### Principes
- **Map-first :** La carte occupe 100% de l'écran. Tout le reste est overlay.
- **Toulouse-native :** Couleurs officielles des lignes Tisséo, icônes par mode, connaissance locale.
- **Dark mode par défaut** — rendu cartographique plus élégant, meilleur contraste pour les données RT.
- **Animations subtiles :** Transitions CSS (300ms ease-out), mouvement véhicules smooth.
- **Accessibilité :** Labels ARIA, contraste AA, navigation clavier, `prefers-reduced-motion`.
- **Mobile-first responsive :** Bottom sheet tactile, gestes natifs. Desktop pas négligé (sidebar, hover states).

### Design Tokens

```css
:root {
  --bg-primary: #0f1117;
  --bg-surface: #1a1d27;
  --bg-elevated: #242836;
  --text-primary: #e4e6ef;
  --text-secondary: #8b8fa3;
  --text-muted: #555970;

  --accent: #6c63ff;
  --accent-hover: #7f78ff;
  --on-time: #2dd4a8;
  --minor-delay: #f5a623;
  --major-delay: #ef4444;

  --metro-a: #E3004F;    /* Couleurs officielles Tisséo */
  --metro-b: #FFB300;
  --tram-t1: #00A651;
  --tram-t2: #6F2282;
  --teleo: #00ADEF;

  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;

  --shadow-md: 0 4px 12px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.4);

  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;

  --transition-fast: 150ms ease-out;
  --transition-normal: 300ms ease-out;
}

[data-theme="light"] {
  --bg-primary: #f8f9fb;
  --bg-surface: #ffffff;
  --bg-elevated: #f0f1f5;
  --text-primary: #1a1d27;
  --text-secondary: #6b7084;
  --text-muted: #9ca0b0;
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
}
```

---

## 11. Déploiement

### Caddyfile

```
toloseo.example.com {
    encode zstd gzip

    handle /api/* {
        reverse_proxy localhost:3000
    }

    handle {
        root * /opt/toloseo/web/dist
        file_server
        try_files {path} /index.html
    }

    header {
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(self)"
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    }

    header /assets/* Cache-Control "public, max-age=31536000, immutable"
}
```

### systemd

```ini
[Unit]
Description=Toloseo Backend
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/toloseo/server
ExecStart=/usr/local/bin/bun run src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Script firewall Cloudflare (ufw-cloudflare.sh)

```bash
#!/bin/bash
# Autorise uniquement les IPs Cloudflare sur les ports HTTP/HTTPS
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from $ip to any port 80,443 proto tcp
done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow from $ip to any port 80,443 proto tcp
done
ufw deny 80/tcp
ufw deny 443/tcp
ufw enable
```

---

## 12. Phases de développement

### Phase 1 — Fondations (2 jours)
- [ ] Init monorepo, configs TS, linting
- [ ] Backend : Hono + Bun, `/api/health`
- [ ] Download + parse GTFS statique en mémoire
- [ ] Endpoints `/api/lines`, `/api/stops?bbox=...`
- [ ] Frontend : SolidJS + Vite + MapLibre + OpenFreeMap
- [ ] Affichage arrêts sur la carte

### Phase 2 — Temps réel (2 jours)
- [ ] Polling GTFS-RT (protobuf), parsing, store mémoire
- [ ] Check VehiclePosition, fallback interpolation
- [ ] Endpoint SSE `/api/stream` avec heartbeat
- [ ] Client SSE + reconnexion + exponential backoff
- [ ] Véhicules sur la carte avec animation
- [ ] Alertes (bandeau)

### Phase 3 — Tracés & interactions (2 jours)
- [ ] Shapes → GeoJSON, endpoint `/api/lines/:id/shape`
- [ ] Rendu tracés colorés sur la carte
- [ ] Sélecteur de lignes (sidebar desktop + bottom sheet mobile)
- [ ] Popup arrêt avec prochains départs
- [ ] Géolocalisation + "arrêts proches"

### Phase 4 — Departure Board & UX (2 jours)
- [ ] Vue `/board/:stopId` — afficheur type gare
- [ ] Dark/light mode
- [ ] Clustering arrêts
- [ ] Responsive polish (mobile + desktop)
- [ ] Animations CSS, loading states

### Phase 5 — Analytics (2 jours)
- [ ] SQLite schema + collector (snapshot 1/min)
- [ ] Calendrier scolaire + jours fériés
- [ ] Endpoints analytics
- [ ] Vue `/analytics` — graphiques retard, fiabilité, heatmap
- [ ] Badges tendance dans le sélecteur de lignes

### Phase 6 — PWA & Production (2 jours)
- [ ] Service worker + manifest PWA
- [ ] Cache offline (GTFS statique + tuiles visitées)
- [ ] Déploiement Caddy + systemd + Cloudflare
- [ ] UFW Cloudflare-only
- [ ] CI/CD GitHub Actions
- [ ] README avec screenshots, architecture, licence

---

## 13. Métriques cibles

| Métrique | Cible |
|----------|-------|
| Time to interactive | < 2s sur 4G |
| Bundle JS (gzip) | < 180kB (SolidJS + MapLibre) |
| Latence SSE | < 500ms (changement Tisséo → écran client) |
| Lighthouse Performance | > 90 |
| Lighthouse PWA | > 90 |
| RAM serveur | < 250 Mo |
| Disque analytics (90j) | < 50 Mo |
| Uptime | > 99.5% |

---

## 14. Licence & Attribution

- **Code :** MIT
- **Données transport :** Licence ODbL — Tisséo / Toulouse Métropole
- **Tuiles :** OpenFreeMap © OpenMapTiles, données © OpenStreetMap contributors
- **Attribution visible** sur la carte (MapLibre l'ajoute automatiquement)

---

## 15. Notes pour Claude Code

### Conventions

- **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess: true`)
- **ESM only** (pas de CommonJS)
- **Nommage :** `camelCase` variables/fonctions, `PascalCase` types/composants, `kebab-case` fichiers
- **Pas de `any`** — `unknown` + type guards
- **Erreurs typées** — classes d'erreur custom, pas de `throw new Error(string)` nu
- **Fonctions ≤ 30 lignes** — extraire si plus
- **Pas de commentaires évidents** — code auto-documenté
- **Imports explicites** — pas de `import *` sauf protobufjs

### Patterns

- **Backend :** Chaque fichier de route exporte une fonction qui prend le `Hono` app et enregistre ses routes.
- **Frontend :** Composants SolidJS fonctionnels, stores séparés, pas de logique métier dans les composants.
- **Types partagés :** `shared/types.ts` importé par les deux apps.
- **Gestion d'erreurs :** Try/catch aux limites (routes, polling), pas de try/catch profond. Les fonctions utilitaires propagent les erreurs.
- **Tests :** Pas dans le scope MVP, mais la structure doit les rendre faciles à ajouter (injection de dépendances, pas de singletons mutables globaux).
