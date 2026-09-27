# AI Agent Instructions

These instructions apply to all AI coding agents working in this repository. More specific nested `AGENTS.md` files may add local rules but may not weaken repository security or source-of-truth requirements.

## Project overview

Ice Ice Water! is a browser freeze-tag game with desktop and mobile touch support. Private invite rooms allow up to 150 total members; at least two active Ice/Water players are required to start. Frostline is the only map available to players. Before countdown, each player selects ICE, WATER, or SPECTATOR. Frozen Water remains a participant and can be rescued; there is no elimination, death, or respawn mechanic. Spectators are an explicit non-participating role.

## Sources of truth

- `PRD.md`: product requirements and MVP scope
- `ARCHITECTURE.md`: technical structure and decisions
- `ART_DIRECTION.md`: visual language, asset sourcing, and generation prompts
- `TASKS.md`: current work and status
- `implementation_plan.md`: obsolete FPS proposal; do not implement it
- `MAP_SPEC.md`: Frostline/Island layouts and shared geometry
- `AGENTS.md`: AI-agent working rules

Read `PRD.md` and `ARCHITECTURE.md` before implementing any major feature. Check `TASKS.md` before starting work and keep the relevant entry accurate when requested to manage task status.

When documents disagree, stop and surface the conflict. Do not silently choose a new requirement or architecture.

## Tech stack

- TypeScript throughout application code
- Three.js for the 3D browser client
- React for lobby, HUD, settings, and results
- Vite for client development and builds
- Node.js and Colyseus for authoritative rooms and networking
- PostgreSQL for durable data
- Redis only when documented multi-process requirements justify it
- npm workspaces for the monorepo
- Vitest, Playwright, and multiplayer load tests

## Planned folder structure

```text
apps/client/       Browser UI and Three.js presentation
apps/server/       Authoritative Colyseus server
packages/shared/   Safe shared protocol types and pure utilities
tests/e2e/         Browser-level critical flows
tests/load/        Simulated multiplayer clients
assets/            Source guidance and optimized runtime assets
```

Respect the module responsibilities in `ARCHITECTURE.md`. Do not create alternate top-level application structures without documenting and approving the change.

## Coding conventions

- Use strict TypeScript. Do not introduce `any` without a narrow, documented integration reason.
- Prefer small, cohesive modules and pure functions for game-rule calculations.
- Validate data at process and trust boundaries.
- Use early returns to keep control flow readable.
- Avoid hidden global mutable state.
- Express phase transitions explicitly; do not scatter timer-based transitions across handlers.
- Keep authoritative rules on the server and visual presentation on the client.
- Add comments for intent and constraints, not for obvious syntax.
- Follow the configured ESLint and Prettier rules once available.

## Naming conventions

- Files and directories: `kebab-case`, except framework-required names
- TypeScript variables and functions: `camelCase`
- Classes, React components, types, and interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE` only for true module-level constants
- Boolean values: use `is`, `has`, `can`, or `should` prefixes
- Database tables and columns: `snake_case`
- Colyseus messages: lowercase `domain/action`, such as `action/interact`
- Tests: `<unit>.test.ts` for unit/integration tests and `<flow>.spec.ts` for browser tests

## Architecture rules

- The server is authoritative for position, movement stance, role/team, freeze/rescue state, cooldowns, spectator eligibility, phase deadlines, and results.
- Clients send input and action intent, never trusted outcomes.
- One active match belongs to one Colyseus room and one server process.
- Live room state remains in memory; do not persist per-tick state to PostgreSQL.
- `packages/shared` may contain protocol types, constants, and pure utilities only.
- The client and server must not import directly from one another.
- Disable player-to-player physical collision unless the PRD and architecture are intentionally revised.
- Reject gameplay at/after the match deadline and all actions from role spectators. Frozen Water cannot move but remains a participant and can be rescued.
- Keep movement, freeze/rescue, and team balance in shared configuration. Spectators do not count toward active minimums, Ice quotas, Water counts, or win conditions.
- Pass the selected map through movement, prediction, spawn height, and visibility. Regenerate Island assets with `npm run assets:island`; never independently rescale the rendered mesh or edit generated triangle data.
- Preserve original supplied GLBs and asset attribution. Keep documented permission gaps visible until reviewed.
- Optimize only after measurement, except for established 150-player constraints documented in the architecture.
- Never change architecture or introduce a major dependency without documenting the reason, alternatives, and consequences in `ARCHITECTURE.md`.

## Planned commands

Run commands from the repository root unless a package says otherwise:

```bash
npm install          # Install workspace dependencies
npm run dev          # Run client and server locally
npm run test         # Run unit and integration tests
npm run test:e2e     # Run critical browser flows
npm run test:load    # Run multiplayer load scenarios
npm run lint         # Check lint rules
npm run typecheck    # Check TypeScript types
npm run build        # Build all production packages
```

These commands are a required scaffold contract. Until package manifests exist, do not claim that they have run successfully.

## Dependency rules

- Prefer platform and existing dependency capabilities before adding packages.
- Add a dependency only to the workspace that uses it.
- Check maintenance status, license, browser/server compatibility, bundle cost, and security before addition.
- Pin through the lockfile and commit `package-lock.json`.
- Do not add overlapping libraries for the same responsibility without removing or justifying the existing choice.
- Redis, a physics engine, analytics, authentication providers, and infrastructure orchestrators are major additions requiring an architecture update.
- Prefer verified free-tier services for the initial private playtest, but document operational limits and do not misrepresent a sleeping or trial service as production-ready.
- Never install a dependency merely to replace a small, clear utility.

## Database and API conventions

- Make every schema change through a committed migration.
- Use UUID durable identifiers and UTC timezone-aware timestamps.
- Access PostgreSQL through server repository modules, not from rooms or clients directly.
- Use transactions for related match-summary writes.
- Keep HTTP endpoints narrow and version them if a public API grows.
- Define and validate all network payloads.
- Include movement input sequence numbers where reconciliation requires them.
- Keep protocol changes backward-compatible within a deployment when practical; otherwise update client and server together.

## Security rules

- Never expose secrets or commit `.env`.
- Never place secrets in `VITE_` variables; they are visible to browsers.
- Treat every client payload as hostile.
- Validate session tokens, message shape, ranges, rates, cooldowns, and current phase.
- Sanitize display names and any user-visible input.
- Rate-limit session creation, joins, gameplay actions, role changes, and ping messages.
- Use HTTPS and secure WebSockets outside local development.
- Do not log tokens, connection strings, secrets, or unnecessary personal data.
- Do not implement client-authoritative shortcuts, even temporarily, without isolating them to explicit local test fixtures.
- Report discovered credential exposure or security weaknesses immediately; do not conceal them in unrelated changes.

## Testing expectations

- Add or update tests with every behavioral change.
- Unit-test pure game rules and boundary cases.
- Integration-test room lifecycle, invalid messages, reconnection, and database writes.
- Test phase deadlines with controlled/fake time rather than slow real-time waits.
- Test role validation, spectator-excluded team balancing, freeze/rescue rules, deadlines, reconnect continuity, and spectator gameplay rejection.
- Include browser tests for lobby role selection, join/play, movement, tag/rescue, spectator viewing, scoreboard, results, and mobile controls.
- Add load scenarios progressively at 20, 50, 100, and 150 clients.
- A change is not complete until relevant tests, lint, type checking, and builds pass, or the handoff clearly documents why they could not run.
- Never weaken or delete a failing test merely to make a change pass unless the requirement itself changed and the source-of-truth documents were updated.

## Documentation expectations

- Update `PRD.md` when approved product behavior changes.
- Update `ARCHITECTURE.md` when technical boundaries or major decisions change.
- Update `ART_DIRECTION.md` when the visual language, asset-license policy, or generation-prompt standards change.
- Update `TASKS.md` when explicitly managing work status or completing tracked work.
- Update `README.md` when setup, commands, prerequisites, or contributor-facing behavior changes.
- Record assumptions explicitly instead of presenting them as confirmed requirements.
- Keep documentation concise and consistent; remove stale guidance when replacing it.

## Working behavior

- Keep changes focused on the assigned task.
- Do not modify unrelated files unnecessarily.
- Preserve user changes and inspect the working tree before editing.
- Do not reformat unrelated files.
- Do not start major features without reading the PRD and architecture.
- Do not silently expand MVP scope.
- Veck.io may inform broad arena-FPS qualities. Import third-party assets only after inspecting the original source and license or applicable written permission; retain provenance and attribution. Do not infer permission from public game files. The user reports permission for some Veck.io assets, but no files are imported until the supplied source/permission is inspected.
- Before generating a visual asset, write and retain a structured production prompt that states purpose, composition, palette, constraints, and explicit IP exclusions.
- Before importing an internet asset, verify its original source and license, record both, and preserve any required attribution.
- If a requested change conflicts with the PRD or architecture, explain the conflict and update the source of truth only with clear authorization.
- Summarize changed files, verification performed, and remaining risks in the final handoff.


## Freeze-tag implementation notes

- Keep mobile input parity and portrait/landscape controls. Reset held intent on blur, disconnect, hidden tabs, pointer cancellation, and pointer-lock loss.
- The role protocol accepts exactly `ice`, `water`, and `spectator`; `random` is only the internal unselected team preference. Validate role messages server-side.
- Use selected-map shared geometry for collision, prediction, and rendering. No untracked decorative cover. Island spawn generation must verify a clear exit, not just a clear standing point; retain ledge-support and low-ceiling regression coverage.
- Treat `implementation_plan.md` as obsolete. Do not add health, weapons, duel, solo-start, elimination, or respawn behavior to satisfy stale FPS tests or documents.
- Browser tests may control authoritative state only inside their test worker fixture. Never ship test control endpoints or trust browser outcomes.
- Same-process five-second load smoke checks do not establish full-match capacity, 20 Hz server throughput, or mobile rendering FPS. Report limits accurately.
