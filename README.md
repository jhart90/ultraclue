# Ultra Clue

A browser-based, real-time multiplayer murder-mystery board game for up to 8 players on
separate computers. A scaled-up *Clue*: 40 suspects, 40 weapons, 40 rooms.

See [PLAN.md](PLAN.md) for the full architecture and milestone plan.

## Stack

TypeScript monorepo (npm workspaces):

- `shared/` — types, the socket protocol, the pure game-rules engine, and card/board data.
- `server/` — Express + Socket.IO authoritative game server (serves the built client in prod).
- `client/` — React + Vite front end.

## Develop

```bash
npm install
npm run dev
```

- Client (Vite): http://localhost:5173
- Server (Socket.IO): http://localhost:3001 (the Vite dev server proxies `/socket.io` to it)

Open http://localhost:5173 in two browser windows to see the live connection round-trip.

## Other scripts

```bash
npm test        # run the shared rules-engine test suite (Vitest)
npm run build   # build the client into client/dist
npm start       # run the server in production mode (serves client/dist if present)
npm run typecheck
```

## Deploy to a public URL (multiplayer over the internet)

Ultra Clue is a persistent Node + Socket.IO server, so it needs a host that supports
long-running processes and WebSockets (not a static host like GitHub Pages). It serves the built
client from the same origin and binds to `process.env.PORT`, so no extra config is needed. Two
one-click options, both deploy straight from this repo:

### Render (free, recommended for testing)

1. Sign in at <https://render.com> with GitHub.
2. **New ▸ Blueprint**, pick the `jhart90/ultraclue` repo. Render reads [`render.yaml`](render.yaml).
3. Click **Apply**. In ~2–3 minutes you get a URL like `https://ultra-clue.onrender.com`.

Share that URL — open it in multiple browsers/computers, one player clicks **Start Game** and
reads off the room code, the others **Join Game** with it. (The free instance sleeps after ~15 min
idle and takes a few seconds to wake on the next visit.)

### Railway

1. Sign in at <https://railway.app> with GitHub.
2. **New Project ▸ Deploy from GitHub repo**, pick `jhart90/ultraclue`. Railway reads
   [`railway.json`](railway.json).
3. Open the service ▸ **Settings ▸ Networking ▸ Generate Domain** to get a public URL.

Both run `npm install --include=dev && npm run build` then `npm start`.

## Overriding card art / text

Drop your own assets into `assets/overrides/{suspects,weapons,rooms}/<card-id>.svg|png` to
replace the procedural art for any card. (Wired up in milestone M1.)
