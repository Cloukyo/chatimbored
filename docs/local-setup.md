# Local Setup

## Requirements

- Node.js 20 or newer.
- npm.
- Godot 4.x.

No environment variables are required for the prototype. The server defaults to port `8787`; set `PORT` to override it.

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

## Test Two Local Players

1. Start the Node server.
2. Run the Godot project once and create a room.
3. Run a second Godot instance or a second exported/web instance.
4. Enter a different display name and join with the room code.
5. Ready the non-host player.
6. Start Button Race as host.
7. Press the button in each client for 10 seconds.
8. Confirm the server declares a winner and the host can return the room to lobby.

## Future Browser Export

When exporting to Web from Godot later:

1. Keep the server running at a reachable WebSocket URL.
2. Export the Godot project from `client-godot/`.
3. Configure `NetworkManager.server_url` for the deployed WebSocket endpoint.
4. Serve the exported files from a static host.

For production hosting, use secure WebSockets (`wss://`) and an explicit allowed origin policy.
