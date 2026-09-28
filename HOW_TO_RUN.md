# How to Run Ice Ice Water!

## Prerequisites

Install the following before starting:

- Node.js 24.18.0
- npm 11.17.0
- Docker Desktop using Linux containers
- A modern browser with WebGL 2 support

## First-time setup

Open a terminal in the repository root and run:

```bash
npm install
npm run setup:local
npm run db:up
npm run db:migrate
npm run dev
```

`setup:local` creates a local `.env` file with random development credentials. It does not overwrite an existing `.env` file.

When startup finishes, open:

```text
http://localhost:5173
```

`http://127.0.0.1:5173` is also supported for local development.

Keep the terminal running while playing. The browser client uses port `5173`, and the game server uses `127.0.0.1:2567`.

> On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` instead, such as `npm.cmd run dev`.

## Run it again later

Start Docker Desktop, then run:

```bash
npm run db:up
npm run dev
```

You only need to run `npm install` again after dependencies change. Run `npm run db:migrate` after pulling new database migrations.

To stop the app, press `Ctrl+C` in the development terminal. To stop PostgreSQL while retaining its data, run:

```bash
npm run db:down
```

## Test a match by yourself

One player can start solo practice. Optionally add wandering targets by setting this value in `.env`:

```dotenv
DEV_BOT_COUNT=5
```

Restart `npm run dev`, create a private room, and start solo or with development bots. Choose FFA, team deathmatch, or duel; duel allows at most two occupants, so use zero or one bot for it.

## Troubleshooting

### Cannot reach the game server

Confirm that `npm run dev` started both the client and server. Then visit:

```text
http://127.0.0.1:2567/health
```

It should return an `ok` response. Also check that no other processes are using ports `5173` or `2567`.

### PostgreSQL port 5432 is unavailable

Change both values in `.env` to use another host port, for example:

```dotenv
POSTGRES_PORT=55432
DATABASE_URL=postgresql://icewater:<your-password>@localhost:55432/icewater
```

Keep the existing password from your `.env`, then rerun `npm run db:up` and `npm run db:migrate`.

### Docker database does not start

Make sure Docker Desktop is running and configured to use Linux containers before running `npm run db:up`.

## Useful checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Production Docker, Linode, database migration, DNS, and HTTPS/WSS instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). They use a separate Compose file; the local `compose.yaml` and development workflow remain unchanged.

See [README.md](README.md) for gameplay controls, configuration options, browser tests, and load-test commands.
