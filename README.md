# Ice Ice Water!

Ice Ice Water is a browser freeze-tag game with desktop and mobile controls, private invite rooms, and server-authoritative movement, roles, freezing, and rescue.

The FPS proposal in `implementation_plan.md` is obsolete and is not part of the game. Ice and Water are active roles; Spectator is an explicit lobby choice. Frozen Water remains a participant and can be rescued. Spectators are not assigned to either team, cannot send gameplay actions, and watch by switching between connected Ice/Water players. Frostline is the only map players can select or play; retained alternate map implementations and assets are not exposed in rooms.

## Run locally

Use **Node 24.18.0**, **npm 11.17.0**, Docker Desktop with Linux containers, and a WebGL 2 browser.

```bash
npm install
npm run setup:local
npm run db:up
npm run db:migrate
npm run dev
```

Open **http://localhost:5173** (or **http://127.0.0.1:5173**). Server: **127.0.0.1:2567**. Keep the terminal running. On PowerShell, use `npm.cmd` if `npm.ps1` is blocked. Setup creates an ignored `.env` and preserves an existing one. Never put secrets in browser-visible `VITE_` variables.

The local database uses `POSTGRES_PORT` (5432 in `.env.example`) and is bound to loopback by `compose.yaml`. Docker must be running. If port 5432 is reserved, set both `POSTGRES_PORT` and the port in `DATABASE_URL` to another port. `db:down` retains data. Gameplay runs without PostgreSQL, but summary writes fail and `/ready` reports 503.

For the separate Linode/Ubuntu production Compose stack, HTTPS/WSS, migration, DNS, and operations instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It does not replace the local Compose or development Quick Tunnel workflow.

## Play

1. Choose a name and create or join a private Frostline room with its eight-character invite code.
2. Choose `Random` or `User picks` team assignment, then select `ICE`, `WATER`, or `SPECTATOR` before countdown.
3. At least two connected Ice/Water players are required. Spectators do not count toward team balancing or match minimums.
4. Ice freezes nearby Water with left-click; Water rescues frozen teammates with the same interaction. Frozen players cannot move but remain on Water and can be rescued.
5. Ice wins when all Water players are frozen. Spectators watch and can switch between connected Ice/Water players. Results appear after the match.

**Desktop:** WASD/arrows move; mouse aims; Space jumps; Shift sprints; C slides; RMB lunges; left-click tags or interacts; hold Tab for scores; Esc releases the cursor. Spectators switch views with the on-screen controls or arrow keys.

**Mobile:** movement stick, drag-to-look area, Tag / Rescue, Lunge, Jump, Slide, Scores, Crouch / Dive, and Sprint. Controls support simultaneous fingers and portrait/landscape. Spectators use Previous / Next controls to switch views. Settings offers Automatic/Touch/Keyboard and mouse if device detection is unreliable.

Host transfers on departure. Fresh joins close at countdown. Unexpected disconnects reserve identity for 25 seconds by default; reload/reconnect preserves role, position, freeze state, and match deadlines. Disconnecting or leaving never changes a player into the Spectator role.

## Development bots

Optional `DEV_BOT_COUNT=5` fills five seats with wandering Ice/Water participants. Bots use the normal authoritative movement, freeze, and rescue rules. Bots reserve room capacity and always leave one human seat. Production disables them.

## Commands and checks

| Command                    | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`              | Client and authoritative server                                           |
| `npm test`                 | Rules, real WebSocket security/lifecycle, database integration            |
| `npm run test:e2e`         | Lobby, role assignment, freeze/rescue, spectator, and mobile flows         |
| `npm run test:load`        | 20/50/100/150-client five-second gameplay smoke checks                    |
| `npm run test:load -- 150` | One staged population                                                     |
| `npm run lint`             | ESLint and Prettier                                                       |
| `npm run typecheck`        | Strict TypeScript, including tests                                        |
| `npm run build`            | All production packages and SQL migrations                                |
| `npm run assets:island`    | Rebuild Fort geometry/collision and validate authored Frost Island spawns |
| `npm run assets:original`  | Bake collision from the restored first procedural world                   |
| `npm run db:migrate`       | Transactional checksummed migrations                                      |

Playwright starts an isolated Vite on 5174 and a real server inside the test worker on 2568, with zero bots and a test persistence stub. Its test-only server fixture controls poses/deadlines for combat/results assertions; no control endpoint or client-authoritative shortcut ships. Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL=chrome`/`msedge` for an installed signed browser. Restricted Windows runners need permission to terminate test child processes. Touch input is tested through CDP multitouch; this runner may report no touch capability despite emulation.

Database tests require `TEST_DATABASE_URL` pointing at a disposable database; never production. They skip when absent. Full-match capacity, remote-network latency, and physical mobile-device FPS remain unverified. Five-second same-process load smoke results do not establish 20 Hz throughput or public release readiness; see `TASKS.md`.

## Configuration

| Variable                                | Default/constraint                                                 |
| --------------------------------------- | ------------------------------------------------------------------ |
| `VITE_GAME_SERVER_URL`                  | ws://localhost:2567; public browser config                         |
| `GAME_SERVER_HOST` / `GAME_SERVER_PORT` | 127.0.0.1 / 2567                                                   |
| `CLIENT_ORIGIN`                         | http://localhost:5173; equivalent loopback origin accepted locally |
| `GUEST_SESSION_SIGNING_SECRET`          | Required random secret, at least 32 characters                     |
| `GUEST_SESSION_TTL_SECONDS`             | 3600; range 60–86400                                               |
| `ROOM_MAX_PLAYERS`                      | 150; range 1–150, humans plus bots                                 |
| `DEV_BOT_COUNT`                         | 0; at most room capacity minus one; off in production              |
| `COUNTDOWN_SECONDS`                     | 5; range 1–30                                                      |
| `RECONNECT_SECONDS`                     | 25; range 20–30                                                    |
| `DATABASE_URL`                          | PostgreSQL; required in production                                 |
| `POSTGRES_PASSWORD` / `POSTGRES_PORT`   | Local Compose credentials/port                                     |
| `TEST_DATABASE_URL`                     | Optional isolated test database                                    |

Ice/Water team balancing excludes selected Spectators. Movement and match tuning lives in shared constants. Production requires HTTPS/WSS with a trusted TLS proxy and private raw game port. No hosting is configured.

Routes remain `/health`, `/ready`, `POST /api/guest-session`, `POST /api/rooms`, `POST /api/rooms/join`. Room APIs require a signed guest token; public Colyseus matchmaking remains blocked.

## Sources of truth

[PRD](PRD.md), [architecture](ARCHITECTURE.md), [map specification](MAP_SPEC.md), [art direction](ART_DIRECTION.md), [tasks and verification](TASKS.md), [agent rules](AGENTS.md), [contributing](CONTRIBUTING.md). The FPS `implementation_plan.md` is obsolete.

`apps/client` renders and captures input; `apps/server` owns outcomes; `packages/shared` holds safe types/constants/pure simulation; `tests` holds browser/load scenarios. Frostline and retained map assets follow the existing provenance and permission records; see [asset provenance](assets/asset-provenance.md).

Contributors: Chad Bojelador and Franco Perez.

## Restored first map

Original World geometry and assets are retained for internal reference, but are not selectable or playable. Frostline is the only available map. When maintaining retained Original World topology or rendering, regenerate shared collision with `npm run assets:original`.
