# Local Setup

## Requirements

- Node.js 20 or newer.
- npm.
- Godot 4.x.

No environment variables are required for local testing. The server defaults to port `8787`; set `PORT` to override it.

## Run the Server

```bash
cd server
npm install
npm run dev
```

The server listens at:

```text
ws://localhost:8787
```

## Run the Godot Client

1. Open Godot.
2. Import or open the `client-godot/` folder only.
3. Run the project.

The client connects to `ws://localhost:8787` by default through `NetworkManager.gd`.

To test against another server URL from the editor, set:

```bash
set CHATIMBORED_SERVER_URL=ws://localhost:8787
```

## Test Two Local Players

1. Start the Node server.
2. Run the Godot project once and create a room.
3. Run a second Godot instance or a second exported/web instance.
4. Enter a different display name and join with the room code.
5. Ready the non-host player.
6. Start Button Race as host.
7. Press the button in each client for 10 seconds.
8. Confirm the server declares a winner and the host can return the room to lobby.

## Web Export And Deployment

See [deployment.md](deployment.md) for the full beginner-friendly deployment flow.

Short version:

1. Run `npm run build` and `npm start` in `server/`.
2. Export Godot's `Web` preset to `dist/client-web/index.html`.
3. Host `dist/client-web/` on a static host.
4. Open the hosted web client with `?server=wss%3A%2F%2Fyour-server.example.com`.

For deployed browser testing, use secure WebSockets (`wss://`).
