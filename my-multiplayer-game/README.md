# Prism Pulse Arena (LAN Multiplayer)

Prism Pulse Arena is a polished, server-authoritative multiplayer browser game for local hosting. One machine hosts with Node.js, everyone else joins from desktop or phone browsers using the host IP and room code.

## Gameplay
- **Objective**: hit **40 points** before others or lead when timer expires.
- Collect **energy orbs** (+1 each).
- Grab **powerups** (+3):
  - `BOOST` faster movement
  - `SHIELD` blocks one mine hit window
  - `PULSE` instantly refreshes pulse cooldown
- Drop **mines** to shatter opponents.
- Trigger **pulse blast** (desktop `E`) to push nearby players away.
- Respawn after short delay when eliminated.
- Combo streak bonus every 10 orb pickups.

## Tech
- Node.js + Express + `ws`
- Fixed authoritative server tick: **30 TPS**
- Client snapshot interpolation for smooth movement
- In-game WebSocket chat
- Mobile controls (virtual stick + two action buttons)
- Visual polish: glow rendering, starfield, particles, hit shake, UI glass effects

## Requirements
- Node.js 18+ on host
- Any modern browser for host/joiners

## Run
```bash
cd my-multiplayer-game
npm install
npm start
```
Open on host: `http://localhost:3000`

## Host on LAN
1. Start server with `npm start` on host PC.
2. Find host LAN IP:
   - Windows: `ipconfig`
   - macOS/Linux: `ifconfig` or `ip addr`
3. Ensure firewall allows inbound TCP port `3000`.
4. Players browse to `http://HOST_IP:3000`, enter room code, join.

## Controls
### Desktop
- Move: `WASD` or arrow keys
- Mine: `Space`
- Pulse Blast: `E`

### Mobile
- Left stick: movement
- **MINE** button: drop mine
- **PULSE** button: radial push

## Troubleshooting
- **Port in use**
  - Run on a different port:
    - macOS/Linux: `PORT=3001 npm start`
    - Windows PowerShell: `$env:PORT=3001; npm start`
- **Cannot connect from phone**
  - Confirm same Wi-Fi/LAN.
  - Use host LAN IP, not localhost.
  - Check firewall inbound rules.
- **Game opens but no updates**
  - Make sure WebSocket traffic is not blocked by antivirus/firewall.
- **HTTPS mixed-content warning**
  - Keep protocol consistent (HTTP with ws, HTTPS with wss).

## NPM Scripts
- `npm start` : start server
- `npm run dev` : start server in watch mode
