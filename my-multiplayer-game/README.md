# Neon Room Rush (LAN Multiplayer)

A server-authoritative 2D browser game built with Node.js, Express, WebSockets, and Canvas 2D.

## Features
- Host and join flow (Host Game / Join Game).
- Room code multiplayer (host + joiners on same network).
- Server-authoritative simulation at fixed 30 ticks/sec.
- Snapshot interpolation on clients for smooth movement.
- Competitive gameplay:
  - Collect orbs (+1)
  - Pick up powerups (+2, boost/shield)
  - Drop mines (action key / mobile button)
  - Respawn after getting popped
  - Round timer + win score condition
- In-game chat via WebSocket.
- Mobile controls (virtual joystick + action button).
- Sound effects (WebAudio beeps), screen shake, particle effects.

## Requirements
- Node.js 18+ (works on Windows/macOS/Linux)
- Browser on host and clients (desktop or phone browser)

## Run locally
1. Open terminal in `my-multiplayer-game`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start server:
   ```bash
   npm start
   ```
4. On host machine, open:
   `http://localhost:3000`

## Host / Join steps
### Host device
1. Click **Host Game**.
2. Share your room code and host address with others.
3. Click **Start Round** once at least 2 players are in lobby.

### Joiner devices
1. On host, find LAN IP (see section below).
2. On each client browser open `http://HOST_LAN_IP:3000`.
3. Enter same room code and click **Join Game**.

## How to host on LAN
1. Start server on host machine (`npm start`).
2. Find host IP:
   - Windows: `ipconfig`
   - macOS/Linux: `ifconfig` or `ip addr`
3. Make sure host firewall allows inbound TCP on port `3000`.
4. Other devices on same Wi-Fi/LAN open `http://HOST_IP:3000`.

## Controls
### Desktop
- Move: `WASD` or arrow keys
- Action (drop mine): `Space`

### Mobile
- Left joystick: move
- Right button: drop mine

## Troubleshooting
- **Port 3000 already in use**
  - Stop process using 3000, or run with another port:
    ```bash
    PORT=3001 npm start
    ```
- **Clients cannot connect**
  - Verify everyone is on same network.
  - Use host LAN IP, not `localhost`.
  - Check firewall allows incoming port 3000.
- **Blank page or mixed-content warning**
  - If serving over HTTPS, WebSocket must use WSS automatically from same host.
- **High lag/stutter**
  - Keep devices on stable Wi-Fi.
  - Close heavy background apps.

## Scripts
- `npm start` → run server
- `npm run dev` → run server in watch mode
