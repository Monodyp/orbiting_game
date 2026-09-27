# Ice Ice Water Task Tracker

Current product: private-room freeze-tag with ICE, WATER, and an explicit pre-game SPECTATOR role. `PRD.md` and `ARCHITECTURE.md` govern; `implementation_plan.md` is an obsolete FPS proposal. Frozen Water remains a Water participant and can be rescued. There is no elimination, death, or respawn transition.

## Implemented

- Frostline-only private rooms, guest sessions, reconnect reservations, role assignment modes, and ID-highlighted player roster.
- Server-authoritative movement, sprint, slide, lunge, tag/freeze, rescue/protection, chat, match deadlines, and results.
- Spectator role selection, active-team-excluded quotas/minimums, server-side action rejection, and a switchable spectator camera.
- Desktop/mobile controls, lobby preview/audio, settings, scoreboard, match HUD, and Frostline weather/night presentation.

## Current Verification

Role-based spectator correction verified on 2026-09-28:

- `npm test`: 198 passed, 5 skipped across 34 files.
- `npm run typecheck`: passed for shared, client, server, and workspace tests.
- `npm run build`: passed for shared, server, and client. Vite reports the existing large-chunk advisory.
- `npm run test:e2e`: 6 passed in Chromium, covering lobby roles/roster, Frostline, chat, spectator viewing, freeze/rescue, mobile controls, and settings.
- `npx eslint .`: passed. `npm run lint` reaches Prettier but reports 133 formatting differences across the existing worktree; no workspace-wide reformat was applied.
- The chat browser case also passed three consecutive isolated repetitions after its unnecessary second render loop was closed.
- Physical-device performance, sustained full-room capacity, and external asset-permission gates remain unverified.

## Open Release Gates

- Independent-process load and tick-latency measurements for 20/50/100/150 room members.
- Physical Android/iOS portrait/landscape and desktop GPU performance checks.
- Multiplayer route, spawn/camping, accessibility, balance, and latency playtests.
- Independent permission evidence for retained supplied map and character/music assets.
- Staging deployment with HTTPS/WSS, proxy isolation, telemetry, and documented limits.

## Historical Evidence

The following FPS/map measurements are retained for engineering history only. They do not establish current gameplay requirements or current verification status.

### Original World visual polish — 2026-09-20

- Preserved the existing topology, spawn logic and all baked collision triangles, including the existing working-tree river/coast fixes. Added a byte-for-byte collision regression and retained manifold, winding, raycast, spawn and water checks.
- One bounded player-centered moon shadow map, five shadowless local lights, blended biome colors, procedural material/water detail, warm inset cover/bridge/windmill accents and fewer than 800 GPU-animated particles. Reduced effects disables shadows/particles/animation; touch halves particles and uses a 1024 shadow map. No new dependency, imported asset, transmission pass or bloom compositor.
- Full unit/integration run: 108 passed; five database tests could not connect to PostgreSQL at local port 55432. No database assertions were changed.
- Final focused Original World run: all 15 tests passed. `npm run lint`, `npm run typecheck`, and `npm run build` passed. These checks do not compile shaders on a real GPU or establish runtime frame rates.
- No browser automation, screenshots or visual review were performed, per the user's instruction. Shader appearance, player-level readability and device/GPU performance remain unverified; full-match/device release gates remain open.

### Staged load smoke evidence — 2026-09-14

Five seconds of active input/firing, real WebSockets, same-process driver/server, no rendering. These Frostline measurements precede the final Island integration and do not establish sustained 20 Hz capacity.

| Clients | Join ms | Observed simulation tick changes | Kills | Driver timer p95 ms |
|---|---:|---:|---:|---:|
| 20 | 679 | 81 | 15 | 4 |
| 50 | 1544 | 61 | 46 | 10 |
| 100 | 3359 | 18 | 61 | 40 |
| 150, encoder rerun | 6224 | 29 | 126 | 38 |

The first 150-client run overflowed the 32 KiB schema buffer. A 64 KiB buffer removed that failure on rerun. Larger populations did not sustain the target tick rate; the configured 150-player cap is not verified production capacity. Independent-process full-match profiling on all three maps, physical-device performance, balance, accessibility and asset-permission evidence remain open.

### Original World verification ? 2026-09-15

- npm test: 92 passed; five PostgreSQL checks failed with ECONNREFUSED on local port 55432. Docker is not running, so migration 005 could not be applied or database-verified. Tests retain their assertions.
- npm run test:e2e: all seven browser flows passed in installed Chrome, including Original World desktop damage/death/respawn/results and simultaneous mobile controls in portrait/landscape.
- npm run lint, npm run typecheck, npm run build: passed. Existing bundle-size advisories remain; physical-device performance and full-match capacity are unverified.
- npm run assets:original: regenerated 9,912 matching collision triangles / 178,416 bytes. Independent renderer raycasts and sixteen inward spawn exits passed; desktop/mobile screenshots inspected.
- Repaired the malformed NUL-encoded trailing GLB ignore rule, which had become a wildcard hiding all new files. Previously hidden existing island-layout.ts and the Frost Island production brief are preserved.
