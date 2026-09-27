# Obsolete FPS Proposal

> This document is historical and is not a source of product requirements. Do not implement its FPS, weapons, health, duel, solo-start, elimination, or respawn scope. The current product is the ICE/WATER/SPECTATOR freeze-tag game defined in `PRD.md` and `ARCHITECTURE.md`.

The original seven-phase plan is archived at `docs/archive/approved-fps-implementation-plan.md`. This file records the executed scope and remaining release work. `PRD.md` and `ARCHITECTURE.md` are the current product and technical sources of truth.

## Accepted decisions

- Replace freeze-tag gameplay with an arena FPS; retain superseded tests and specifications only as archived references.
- Keep desktop and mobile touch support, including simultaneous movement, look, and firing.
- Allow one player to start solo practice. FFA, TDM, and duel remain private-room modes; duel is capped at two players.
- Integrate the supplied Island GLB after normalizing scale and deriving shared render/collision geometry. Retain the supplied wooden-house source and provenance, but do not load it or include its former collider in Frostline. The unresolved Island rightsholder-permission question remains a release gate.
- Keep the expanded 120 metre Frostline layout and the existing lobby character/music assets.

## Executed phases

| Phase                        | Result                                                                                                                                     | Primary modules                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Movement and camera          | Authoritative movement, jump, slide, crouch, sprint, surfaces, prediction, pointer lock, and touch look                                    | `packages/shared/src/simulation`; `game-input`; `first-person-camera`; `player-motion` |
| Combat                       | Six weapons, ammo, reload, ADS, spread, falloff, headshots, authoritative damage/death, and feedback                                       | `weapons`; `weapon-controller`; `damage-system`; `weapon-renderer`                     |
| Match loop                   | FFA/TDM/duel, solo practice, score/time limits, teams, respawn protection, reconnect, results, and summaries                               | `match-controller`; `gameplay-controller`; `spawn-manager`; `private-room`             |
| Maps                         | Original World restoration plus Frostline and hybrid Frost Island archipelago collision, outer spawns, routes, Fort ruin, and closed house | `arena`; `island-layout`; `island-collision`; `FrostlineMap`; `IslandMap`              |
| HUD and controls             | Health, ammo, timer, score, feed, crosshair, indicators, scoreboard, results, and mobile controls                                          | `apps/client/src/ui`; `hit-effects`; `touch-controls`                                  |
| Loadout, settings, and audio | Loadout selection, persistent settings, lobby preview, synthesized combat cues, and retained lobby audio                                   | `lobby-screen`; `settings-panel`; `fps-settings`; `audio-manager`; `lobby-audio`       |

## Implementation boundaries

The server owns movement outcomes, aim validation, health, ammunition, cooldowns, hits, deaths, respawns, scores, deadlines, and results. Clients send input and action intent only. All current weapons use authoritative hitscan, including the short-range melee trace. Bots wander as optional practice targets and do not shoot. There is no public matchmaking, ranking, store, progression, or legacy freeze-tag mode.

Frost Island preserves the approximately 4.9 MB optimized Fort derivative as its central ruin and applies one shared 0.52 scale/Y transform to rendering and triangle collision. Original procedural geometry adds six separate outer/flank islands, multi-route bridges and ice paths, specialized facilities/cover, an 80-metre half-extent, and sixteen outer spawns. The original 136.6 MB source referenced by the build report is absent from the current tree, so rebuilding that derivative is blocked until the source is restored. Edit the shared layout rather than independently moving rendered or collision geometry.

## Verification status

- `npm test`: passed, 81 tests across 20 files, including the database suite.
- `npm run typecheck`: passed for shared, client, server, and root tests.
- `npm run build`: passed for shared, server, and client. Vite retains a large renderer chunk as a tracked advisory.
- `npm run lint`: ESLint and Prettier passed.
- `npm run test:e2e`: 5 passed in Chrome, including desktop Island movement/firing/Escape and simultaneous mobile controls on both maps in portrait/landscape.
- Island movement follow-up: generated spawns require a clear initial exit; feet use radius-based ledge support; standing beneath low ceilings retains crouch. Render/shot collision is checked against the actual GLB, and all sixteen spawns are tested for forward movement.
- Staged 20/50/100/150-client load smoke measurements and remaining limits are recorded in TASKS.md. They do not establish full-match capacity or physical-device frame rate.
- PostgreSQL integration requires a disposable `TEST_DATABASE_URL`; never use production credentials.

## Remaining release gates

1. Independent-process full-match load on all three maps, with tick latency, memory, bandwidth, and results correctness recorded.
2. Physical Android/iOS and desktop GPU playtesting for frame rate, input parity, reload/ADS, and portrait/landscape layouts.
3. Spawn, route, interior/ceiling, weapon-balance, accessibility, and latency/fairness playtests.
4. Independent rightsholder-permission evidence for the supplied reuploaded Island asset and an audit of retained character/music assets.
5. Staging deployment with HTTPS/WSS, proxy isolation, telemetry, and documented operational limits.

### Original World follow-up ? 2026-09-15

The user requested adding their very first GitHub map to the selector. Restored the pre-expansion procedural world from 87a8893, retained all current FPS modes and server authority, baked matching triangle collision, validated sixteen spawn exits, and added migration 005 for summary persistence. See MAP_SPEC.md and TASKS.md for scope and verification.
