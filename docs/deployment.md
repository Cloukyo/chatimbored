# Deployment Guide

This guide prepares `chatImbored` for a temporary online playtest with friends. It does not deploy anything automatically.

## Branch And Release Rule

Treat `main` as the live playtest branch. Anything merged to `main` should be ready for friends to test online.

Future feature work should happen on a separate branch and come back through a pull request. Before merging a pull request into `main`, run the local checks from the repo root:

```bash
npm test
npm run build
```

Also open the Godot project and test the affected minigames locally. Only merge to `main` after those checks pass.

## What Gets Hosted

- Godot Web client: static files exported from `client-godot/` into `client-godot/builds/web/`.
- Node WebSocket server: the `server/` package, built with TypeScript and started with `npm start`.

For deployed playtests, the Godot client should connect to a secure WebSocket URL that starts with `wss://`.

Current Railway WebSocket URL:

```text
wss://chatimbored-production.up.railway.app
```

## Server: Local Production Check

From the repo root:

```bash
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
npm --workspace server run start
```

The server workspace then runs:

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
client-godot/builds/web/index.html
```

The generated `client-godot/builds/web/` folder is the static website folder Vercel serves. It should contain `index.html` plus Godot's generated `.wasm`, `.pck`, and `.js` files.

Command-line export, if your Godot export templates are installed and Godot is on PATH:

```bash
godot --headless --path client-godot --export-release Web builds/web/index.html
```

## Point The Web Client At A Server

Desktop/local Godot defaults to:

```text
ws://localhost:8787
```

For a deployed Web build, open the game with a `server` query parameter:

```text
https://your-vercel-site.vercel.app/?server=wss://chatimbored-production.up.railway.app
```

URL-encoded form, which is safer to paste into some dashboards:

```text
https://your-vercel-site.vercel.app/?server=wss%3A%2F%2Fchatimbored-production.up.railway.app
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

- [Netlify](https://docs.netlify.com/start/choose-your-path/): drag-and-drop or Git-backed deploys for `client-godot/builds/web/`.
- [Cloudflare Pages](https://developers.cloudflare.com/pages/): fast static hosting with simple project setup.
- [Vercel](https://vercel.com/docs/deployments): easy static deployment from a repo or folder.

For the first friends test, a temporary generated URL is fine. A custom subdomain can come later.

Godot references:

- [Exporting for the Web](https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html)
- [Command-line exporting](https://docs.godotengine.org/en/latest/tutorials/export/exporting_projects.html#exporting-from-the-command-line)

## Deployed Testing Flow

1. Deploy the Node server on Railway first.
2. Confirm the server health URL opens:

```text
https://chatimbored-production.up.railway.app/health
```

3. Copy the server's secure WebSocket URL:

```text
wss://chatimbored-production.up.railway.app
```

4. Export the Godot Web client to `client-godot/builds/web/`.
5. Deploy `client-godot/builds/web/` to Vercel as a static site.
6. Open the static site with:

```text
https://your-vercel-site.vercel.app/?server=wss://chatimbored-production.up.railway.app
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

## Railway Server Settings

Use these Railway settings:

- Branch: `main`
- Root Directory: leave empty, or set it to the repo root. Do not set it to `server`.
- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm start`
- Node version: `20` or newer
- Port: leave automatic; the server reads `process.env.PORT`

Railway must build from the repo root because the server imports shared TypeScript files from the sibling `shared/` folder. If Railway's Root Directory is `server`, the build cannot see `shared/` and TypeScript will fail with missing module errors.

Do not upload `client-godot/builds/web/` to the Node server host. It belongs on the static web host.

## Vercel Static Client Settings

Vercel should only host the exported Godot Web client. It should not run the Node WebSocket server and should not deploy this repo as a Next.js app.

Use these Vercel settings:

- Branch: `main`
- Framework Preset: `Other`
- Root Directory: repo root
- Install Command: `npm install`
- Build Command: `npm run vercel-build`
- Output Directory: `client-godot/builds/web`

The committed `vercel.json` sets those project defaults and adds static headers for Godot `.wasm` and `.pck` files.

Before pushing a Vercel deploy, export the Godot Web preset so these files exist:

- `client-godot/builds/web/index.html`
- at least one `client-godot/builds/web/*.wasm`
- at least one `client-godot/builds/web/*.pck`
- at least one `client-godot/builds/web/*.js`

`npm run vercel-build` checks for those files. It does not build or start the Node server.
