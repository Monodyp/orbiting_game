# Deployment

This guide adds a production-only Docker Compose stack for an Ubuntu 24.04 Linode. It does not replace the development `compose.yaml`, `npm run setup:local`, `npm run dev`, or the current Cloudflare Quick Tunnel workflow. No domain, certificates, Linode account, or production secrets are included in this repository.

## Verified application contract

| Item                  | Source-backed value                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node/npm              | Node 24.18.0 and npm 11.17.0, pinned by root `package.json`                                                                                          |
| Server entry point    | `node apps/server/dist/main.js` (`@ice-water/server` start script)                                                                                   |
| Client build          | Build shared, then `npm run build -w @ice-water/client`                                                                                              |
| Client output         | `apps/client/dist` (Vite default, relative to `apps/client`)                                                                                         |
| Client runtime assets | Vite copies `assets/character` to `dist` and bundles imported music/assets                                                                           |
| Server runtime files  | Compiled server/shared output plus SQL migrations copied by `scripts/build-server.ts`                                                                |
| HTTP routes           | `GET /health`, `GET /ready`, `POST /api/guest-session`, `POST /api/rooms`, `POST /api/rooms/join`, and Colyseus `POST /matchmake/reconnect/{roomId}` |
| Room WebSocket        | `/{processId}/{roomId}` on the configured server origin; the browser SDK appends these path segments to `VITE_GAME_SERVER_URL`                       |
| Production database   | Required by production config/readiness; match summaries write to `arena_matches` and `arena_match_players`                                          |
| Migrations            | `apps/server/src/persistence/migrate.ts` runs checksummed migrations `001`–`007` transactionally. Server startup does not run migrations.            |

The production client uses its configured WSS origin for same-origin HTTPS API requests and Colyseus WebSockets. Nginx proxies the API endpoints, reconnect endpoint, and two-segment room WebSocket path. Other paths are static files with SPA fallback. Colyseus does not generate a `publicAddress` override unless cloud mode is explicitly enabled; do not set `COLYSEUS_CLOUD` for this single-process deployment.

The code retains loopback defaults for development (`127.0.0.1:2567` and the Vite development origin). Compose overrides the server bind address to `0.0.0.0`, and Vite receives `VITE_GAME_SERVER_URL` as a build argument. No production server URL is inferred from localhost.

## Architecture

```text
Internet -- HTTPS/WSS --> Nginx :80/:443
                              |-- static React/Vite SPA
                              |-- /api/* and /matchmake/reconnect/* --> Node :2567
                              `-- /{processId}/{roomId} WebSocket --> Node :2567
                                                                  |
                                                                  `--> PostgreSQL :5432
```

`compose.production.yaml` publishes only Nginx. Node and PostgreSQL have no host port mappings. PostgreSQL and Node share an internal Docker network; Nginx joins that network and the ingress network. Keep one server process: each live room belongs to one process, and this deployment does not configure Redis or multi-process room routing.

## Preserve development

Continue using the existing development setup unchanged:

```bash
npm install
npm run setup:local
npm run db:up
npm run db:migrate
npm run dev
```

`compose.yaml` remains the local PostgreSQL service, bound to loopback with its existing `postgres-data` volume. The `.env.example` currently sets the PostgreSQL host port to 5432. This production file does not change development server defaults, Quick Tunnel CORS allowance, or local database commands.

## Local production-stack validation

Docker Engine must be running with Linux containers. Copy the placeholder template to the ignored runtime file and replace its secret placeholders; the unedited template is intentionally rejected by application configuration.

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

For a local HTTP-only container test, set these values in `.env.production`. This is a development-only override, not production configuration:

```dotenv
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:8080
VITE_GAME_SERVER_URL=ws://localhost:8080
TLS_DOMAIN=localhost
ALLOW_INSECURE_WS=true
PUBLIC_BIND_ADDRESS=127.0.0.1
HTTP_PORT=8080
HTTPS_PORT=8443
NGINX_CONFIG=./deploy/nginx/http.conf
LETSENCRYPT_DIR=./.deployment/letsencrypt
ACME_WEBROOT_PATH=./.deployment/acme-webroot
```

Generate a random signing secret and hexadecimal database password. Use the same database password in `POSTGRES_PASSWORD` and `DATABASE_URL`. Keep `DATABASE_URL` pointed at the Compose hostname `postgres`, not localhost.

Build and start the disposable local stack:

```bash
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
docker compose --env-file .env.production -f compose.production.yaml --profile ops run --rm migrate
docker compose --env-file .env.production -f compose.production.yaml up -d server frontend
docker compose --env-file .env.production -f compose.production.yaml ps
```

Open `http://localhost:8080`. Verify `/healthz` returns 204, create a guest and private room, then use a second browser session to test WebSocket join, role assignment, gameplay, chat, spectator viewing, and reconnect. Verify the frontend GLBs are present:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec -T frontend sh -c 'test -s /usr/share/nginx/html/ice_model.glb && test -s /usr/share/nginx/html/water_model.glb && test -s /usr/share/nginx/html/frozen_ice.glb'
```

Confirm the production build has no development WebSocket or Quick Tunnel URL:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec -T frontend sh -c '! grep -R -E "ws://localhost:2567|trycloudflare\.com|discordsays\.com" /usr/share/nginx/html/assets'
```

The Nginx HTTP configuration is only for loopback validation. `ALLOW_INSECURE_WS=true` permits `ws://` at build time for that test; production builds reject it by default.

Stop the local stack without deleting the database:

```bash
docker compose --env-file .env.production -f compose.production.yaml down
```

Do not use `down -v` for routine shutdown.

## Production environment

Copy `.env.production.example` to `.env.production`, set mode `600`, and replace every placeholder. Required application values are:

| Variable                                         | Production value / purpose                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `NODE_ENV`                                       | `production`; enables HTTPS origin validation and disables development overrides |
| `GAME_SERVER_HOST`                               | `0.0.0.0` inside the container                                                   |
| `GAME_SERVER_PORT`                               | `2567`, private to Docker networks                                               |
| `CLIENT_ORIGIN`                                  | Exact `https://` origin, without a path or trailing slash                        |
| `VITE_GAME_SERVER_URL`                           | Public `wss://` origin, without port 2567 or an application path                 |
| `TLS_DOMAIN`                                     | Hostname in the certificate path `/etc/letsencrypt/live/<TLS_DOMAIN>/`           |
| `DATABASE_URL`                                   | `postgresql://icewater:<same-hex-password>@postgres:5432/icewater`               |
| `POSTGRES_PASSWORD`                              | Same randomly generated hexadecimal password used in `DATABASE_URL`              |
| `GUEST_SESSION_SIGNING_SECRET`                   | Random secret of at least 32 characters; generate, do not reuse a placeholder    |
| `GUEST_SESSION_TTL_SECONDS`                      | Defaults to 3600; valid range 60–86400                                           |
| `ROOM_MAX_PLAYERS`                               | Defaults to 150; valid range 1–150; this is not a performance guarantee          |
| `DEV_BOT_COUNT`                                  | `0` in production                                                                |
| `DEV_FORCE_ICE`                                  | `false` in production                                                            |
| `COUNTDOWN_SECONDS`                              | Defaults to 5; valid range 1–30                                                  |
| `RECONNECT_SECONDS`                              | Defaults to 25; valid range 20–30                                                |
| `PUBLIC_BIND_ADDRESS`, `HTTP_PORT`, `HTTPS_PORT` | `0.0.0.0`, `80`, and `443` on the VPS                                            |
| `NGINX_CONFIG`                                   | `./deploy/nginx/https.conf` after DNS/TLS setup                                  |
| `LETSENCRYPT_DIR`                                | Host Certbot directory, normally `/etc/letsencrypt`                              |
| `ACME_WEBROOT_PATH`                              | Host directory mounted for HTTP-01 challenges                                    |

`VITE_GAME_SERVER_URL` is public browser configuration. Only that URL is passed to the frontend build; signing secrets, PostgreSQL credentials, and `DATABASE_URL` are server-side only. `.env.production` is ignored by Git and excluded from Docker build contexts.

## Linode setup

1. Create an Ubuntu 24.04 LTS Linode. A 4 GB shared-CPU instance is a reasonable initial playtest baseline, not a measured capacity promise. Compare available Asia-Pacific regions using actual participant latency; Singapore is a candidate to test, not a verified best region.
2. Point a real domain's A record at the Linode IPv4 address. Add an AAAA record only if IPv6 is configured and reachable. Do not use a made-up domain or a Quick Tunnel URL as the production origin.
3. Configure the Linode Cloud Firewall and Ubuntu firewall for SSH administration plus TCP 80/443 only. Do not open 2567 or 5432.
4. Install Docker Engine and the Compose plugin from Docker's official Ubuntu 24.04 apt repository (see <https://docs.docker.com/engine/install/ubuntu/>):

```bash
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"${UBUNTU_CODENAME:-$VERSION_CODENAME}\") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker version
docker compose version
```

Avoid adding untrusted users to the `docker` group; it grants root-equivalent control. Use `sudo docker ...` if the deployment account is not already authorized.

5. Clone/copy the repository into a deployment directory. Create `.env.production` with real domain values for `CLIENT_ORIGIN` and `VITE_GAME_SERVER_URL`; replace every secret placeholder. Never copy a workstation `.env` or commit production credentials.
6. Before a certificate exists, temporarily set `NGINX_CONFIG=./deploy/nginx/acme-bootstrap.conf`. That config serves only the ACME challenge and `/healthz`, and returns 503 for game routes; it does not expose the game over plaintext HTTP.
7. Create the ACME webroot, build the images, start PostgreSQL, apply migrations, then start Node and bootstrap Nginx:

```bash
mkdir -p .deployment/acme-webroot
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
docker compose --env-file .env.production -f compose.production.yaml --profile ops run --rm migrate
docker compose --env-file .env.production -f compose.production.yaml up -d server frontend
docker compose --env-file .env.production -f compose.production.yaml ps
```

The server healthcheck uses `/ready`, which tests PostgreSQL connectivity. Migrations are a deliberate separate command; server startup never runs them automatically.

## DNS and HTTPS/WSS

Production is not ready for students until a real domain resolves to the VPS and a trusted certificate is installed. TLS certificates and private keys do not belong in this repository.

For Let's Encrypt, install Certbot on Ubuntu using its official instructions: <https://certbot.eff.org/instructions>. During issuance, `NGINX_CONFIG=./deploy/nginx/acme-bootstrap.conf` serves `/.well-known/acme-challenge/` and returns 503 for all other game routes. The host's `/etc/letsencrypt` and ACME webroot are mounted read-only into Nginx.

Set `TLS_DOMAIN` to the same real hostname used by `CLIENT_ORIGIN` and `VITE_GAME_SERVER_URL`. After DNS is live and ports 80/443 reach the Linode:

```bash
sudo certbot certonly --webroot \
  --webroot-path "$PWD/.deployment/acme-webroot" \
  --domain "<REAL_DOMAIN>" \
  --email "<ADMIN_EMAIL>" \
  --agree-tos --no-eff-email
docker compose --env-file .env.production -f compose.production.yaml exec -T frontend nginx -s reload
```

Replace both angle-bracket placeholders with values the owner controls. Then set `NGINX_CONFIG=./deploy/nginx/https.conf` in `.env.production` and recreate Nginx:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --force-recreate frontend
docker compose --env-file .env.production -f compose.production.yaml ps
```

The client image already embeds `wss://<REAL_DOMAIN>` through `VITE_GAME_SERVER_URL`; rebuild it if that URL changes. Certbot's renewal timer must be enabled and tested with `sudo certbot renew --dry-run`; configure a Certbot deploy hook to reload frontend Nginx after renewal. Nginx reads the certificate for the requested SNI hostname under `/etc/letsencrypt/live/<REAL_DOMAIN>/`.

For a deployment checked out at `/opt/ice-ice-water`, install this deploy hook after obtaining the first certificate:

```bash
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/ice-ice-water-nginx >/dev/null <<'EOF'
#!/bin/sh
cd /opt/ice-ice-water
docker compose --env-file .env.production -f compose.production.yaml exec -T frontend nginx -s reload
EOF
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/ice-ice-water-nginx
sudo systemctl list-timers | grep -i certbot
sudo certbot renew --dry-run
```

Change `/opt/ice-ice-water` to the actual deployment directory. Confirm the Certbot renewal timer is enabled; if it is not, enable the timer installed by the selected Certbot package before relying on automatic renewal.

Alternative TLS termination: a trusted external load balancer may terminate HTTPS/WSS and forward HTTP/WebSocket Upgrade traffic to Nginx over a private path. In that case use `NGINX_CONFIG=./deploy/nginx/http.conf`, bind Nginx only to a private interface/firewall source, preserve the original `Host` and `Origin`, and have the load balancer forward Upgrade/Connection and `X-Forwarded-*` headers. Keep browser URLs HTTPS/WSS and `CLIENT_ORIGIN` equal to the original HTTPS origin. Nginx still proxies to the private Node service; never expose Node or PostgreSQL directly. The application validates the browser `Origin` and rejects non-WSS URLs on HTTPS pages.

Verify the public site and WebSocket in a browser's Network panel. The room socket URL is `wss://<REAL_DOMAIN>/<processId>/<roomId>`; there is no `/ws` prefix. The same domain serves guest/room APIs. Do not claim HTTPS/WSS is complete until a trusted certificate and actual domain are configured.

## Operations

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs -f server
docker compose --env-file .env.production -f compose.production.yaml logs -f frontend
docker compose --env-file .env.production -f compose.production.yaml logs -f postgres
docker stats
docker compose --env-file .env.production -f compose.production.yaml restart
docker compose --env-file .env.production -f compose.production.yaml down
docker compose --env-file .env.production -f compose.production.yaml up -d
```

For database diagnostics, use `docker compose ... exec postgres pg_isready -U icewater -d icewater` or `psql` inside the container. Back up PostgreSQL before migrations/releases; this stack does not implement automated backups. Preserve `postgres-production-data` on rollback. Re-deploy a known-good source revision, rebuild its images, and apply only forward-compatible migrations. Never remove the database volume as a routine rollback.

After reboot, reconnect over SSH and run `docker compose ... ps`, check `/healthz`, check server logs and `/ready` from inside the server container, then test from a remote browser. `restart: unless-stopped` restarts containers after reboot.

## Monitoring and capacity

Record `docker stats`, host CPU/RAM, `ss -s`, active TCP sockets, network throughput, and browser-observed latency/jitter during a controlled remote session. The application does not export a public WebSocket count or authoritative tick-rate metric; do not claim those measurements without additional instrumentation. A 4 GB VPS and successful startup do not prove 150-player capacity.

`npm run test:load` runs the existing staged 20/50/100/150 five-second smoke scenario in one process with simulated clients and server state. It does not exercise Nginx, browser rendering, an independent load generator, sustained matches, public-network packet loss, or the target tick rate. Run it progressively and report its output accurately; separately load-test the deployed WSS endpoint before choosing seminar capacity.

## Seminar-day checklist

- Verify the domain A/optional AAAA records and trusted certificate.
- Confirm only SSH and TCP 80/443 are public; 2567 and 5432 remain private.
- Check healthy PostgreSQL, server, and frontend containers and recent logs.
- Confirm `.env.production` permissions and that no secret appears in frontend assets.
- Open the site from a remote network and test WSS, guest creation, room join, roles, movement, freeze/rescue, chat, spectator viewing, and reconnect.
- Measure CPU, RAM, network, client latency, and target population; lower `ROOM_MAX_PLAYERS` if measurements warrant it.
- Confirm PostgreSQL backup and recovery access.

## Blockers and assumptions

- No domain was supplied; DNS, Let's Encrypt issuance, and public HTTPS/WSS cannot be completed until the owner chooses one.
- Docker Engine was unavailable during preparation, so image builds, container health, migrations inside Compose, and local Docker multiplayer validation remain unverified here.
- No Linode was provisioned or measured. Region, monthly price, sustained capacity, latency, and seminar-day performance are unverified.
- The application rate-limits by direct socket peer address and does not trust forwarded headers. Behind one Nginx proxy, IP-based limits aggregate at the proxy address; measure burst behavior before a large seminar. This deployment does not change that application policy.
- Existing development `compose.yaml`, Quick Tunnel CORS allowance, and gameplay/network behavior are unchanged.
