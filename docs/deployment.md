# Deployment Guide

This guide prepares `chatImbored` for a temporary online playtest with friends. It does not deploy anything automatically.

## Branch And Release Rule

Treat `main` as the live playtest branch. Anything merged to `main` should be ready for friends to test online.

Future feature work should happen on a separate branch and come back through a pull request. Before merging a pull request into `main`, run the local checks:

```bash
cd server
npm test
npm run build
```

Also open the Godot project and test the affected minigames locally. Only merge to `main` after those checks pass.

## What Gets Hosted

- Godot Web client: static files exported from `client-godot/` into `dist/client-web/`.
- Node WebSocket server: the `server/` package, built with TypeScript and started with `npm start`.

For deployed playtests, the Godot client should connect to a secure WebSocket URL that starts with `wss://`.

## Server: Local Production Check

From the repo root:

```bash
cd server
npm install
npm run build
npm start
```

The production server command is:

```bash
npm start
```

That runs:

```bash
node dist/server/src/index.js
```

The server uses `PORT` from the host automatically. Locally, it falls back to `8787`.

```bash
set PORT=8787
npm start
```

Local server URL:

```text
ws://localhost:8787
```

Health check:

```text
http://localhost:8787/health
```

## Godot Web Export

The Godot project now has a `Web` export preset.

1. Open Godot.
2. Open only the `client-godot/` folder.
3. Go to `Project > Export`.
4. Select the `Web` preset.
5. Export to:

```text
dist/client-web/index.html
```

The generated `dist/client-web/` folder is the static website folder to upload to Netlify, Cloudflare Pages, Vercel, or another static host.

Command-line export, if your Godot export templates are installed and Godot is on PATH:

```bash
godot --headless --path client-godot --export-release Web ../dist/client-web/index.html
```

## Point The Web Client At A Server

Desktop/local Godot defaults to:

```text
ws://localhost:8787
```

For a deployed Web build, open the game with a `server` query parameter:

```text
https://your-static-site.example/?server=wss%3A%2F%2Fyour-server.example.com
```

The client saves that server URL in browser local storage, so you usually only need the query parameter the first time. To switch servers later, open the page again with a different `?server=...` value.

Advanced option: before the Godot loader runs in the exported HTML, define:

```html
<script>
  window.CHATIMBORED_SERVER_URL = "wss://your-server.example.com";
</script>
```

For native or editor testing, you can also set:

```bash
set CHATIMBORED_SERVER_URL=ws://localhost:8787
```

## Recommended Simple Hosting

Good first server hosts:

- [Railway](https://docs.railway.com/guides/express): simple Node service, good for quick prototypes.
- [Render](https://render.com/docs/websocket): simple Web Service setup and supports WebSockets.
- [Fly.io](https://fly.io/docs/js/): more control, useful later if you need regions or always-on tuning.

Good first static hosts for the Godot Web build:

- [Netlify](https://docs.netlify.com/start/choose-your-path/): drag-and-drop or Git-backed deploys for `dist/client-web/`.
- [Cloudflare Pages](https://developers.cloudflare.com/pages/): fast static hosting with simple project setup.
- [Vercel](https://vercel.com/docs/deployments): easy static deployment from a repo or folder.

For the first friends test, a temporary generated URL is fine. A custom subdomain can come later.

Godot references:

- [Exporting for the Web](https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html)
- [Command-line exporting](https://docs.godotengine.org/en/latest/tutorials/export/exporting_projects.html#exporting-from-the-command-line)

## Deployed Testing Flow

1. Deploy the Node server first.
2. Confirm the server health URL opens:

```text
https://your-server.example.com/health
```

3. Copy the server's secure WebSocket URL:

```text
wss://your-server.example.com
```

4. Export the Godot Web client to `dist/client-web/`.
5. Deploy `dist/client-web/` to a static host.
6. Open the static site with:

```text
https://your-static-site.example/?server=wss%3A%2F%2Fyour-server.example.com
```

7. Create a room.
8. Send friends the same static site URL.
9. Have friends join using the room code.
10. Test Button Race, Act Natural, and Loot & Leave.

## Friend Playtest Checklist

- Everyone can load the web page.
- The host can create a room.
- Friends can join with the room code.
- Ready state updates for every player.
- Host can start each minigame.
- Button Race starts, scores, ends, and returns to lobby.
- Act Natural starts, moves, shoots, ends, and returns to lobby.
- Loot & Leave starts, moves, collects gems, ends, and returns to lobby.
- Refreshing one client does not crash the server.
- The server logs do not show repeated errors during normal play.

## Notes For Hosting Providers

Use these settings as a starting point:

- Branch: `main`
- Root directory: `server`
- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm start`
- Node version: `20` or newer
- Port: leave automatic; the server reads `process.env.PORT`

Do not upload `dist/client-web/` to the Node server host. It belongs on the static web host.

For the static Godot Web host, deploy from `main` too, using the exported `dist/client-web/` folder.
