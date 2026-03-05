const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const ROUND_TIME = 180;
const WIN_SCORE = 40;
const ARENA = { width: 1800, height: 1000 };

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const CLAMP = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => Math.random() * (max - min) + min;
const id = () => Math.random().toString(36).slice(2, 10);

const walls = [
  { x: 390, y: 210, w: 210, h: 26 },
  { x: 1200, y: 200, w: 250, h: 26 },
  { x: 760, y: 460, w: 280, h: 30 },
  { x: 250, y: 730, w: 240, h: 26 },
  { x: 1210, y: 700, w: 260, h: 26 }
];

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function broadcast(room, type, data = {}) {
  for (const client of wss.clients) if (client.roomCode === room.code) send(client, type, data);
}

function roomCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += letters[Math.floor(Math.random() * letters.length)];
  return rooms.has(code) ? roomCode() : code;
}

function spawnPoint() {
  return {
    x: rand(110, ARENA.width - 110),
    y: rand(110, ARENA.height - 110)
  };
}

function createOrb() {
  return { id: id(), x: rand(70, ARENA.width - 70), y: rand(70, ARENA.height - 70), r: 11, glow: rand(0, 1) };
}

function createPowerup() {
  const types = ['boost', 'shield', 'pulse'];
  return { id: id(), x: rand(90, ARENA.width - 90), y: rand(90, ARENA.height - 90), r: 16, type: types[Math.floor(rand(0, types.length))] };
}

function createRoom(host, name) {
  const room = {
    code: roomCode(),
    hostId: host.id,
    inGame: false,
    timer: ROUND_TIME,
    players: new Map(),
    orbs: [],
    powerups: [],
    mines: [],
    pulses: [],
    feed: [],
    lastOrbAt: 0,
    lastPowerAt: 0
  };
  rooms.set(room.code, room);
  addPlayer(room, host, name);
  return room;
}

function addPlayer(room, ws, name) {
  const spawn = spawnPoint();
  room.players.set(ws.id, {
    id: ws.id,
    name: String(name || 'Pilot').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Pilot',
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    r: 19,
    alive: true,
    score: 0,
    streak: 0,
    respawnAt: 0,
    mineCd: 0,
    pulseCd: 0,
    boostUntil: 0,
    shieldUntil: 0,
    input: { up: false, down: false, left: false, right: false, action: false, pulse: false }
  });
  ws.roomCode = room.code;
}

function removePlayer(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  const leaving = room.players.get(ws.id);
  if (leaving) {
    room.feed.push(`${leaving.name} disconnected.`);
    room.players.delete(ws.id);
  }

  if (room.hostId === ws.id) {
    const next = room.players.values().next().value;
    room.hostId = next?.id || null;
    if (next) room.feed.push(`${next.name} became host.`);
  }

  if (!room.players.size) {
    rooms.delete(room.code);
    return;
  }

  roomUpdate(room);
}

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    inGame: room.inGame,
    timer: room.timer,
    walls,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      streak: p.streak,
      alive: p.alive
    }))
  };
}

function roomUpdate(room) {
  broadcast(room, 'roomUpdate', { room: roomState(room) });
}

function resetRound(room) {
  room.timer = ROUND_TIME;
  room.orbs = Array.from({ length: 34 }, createOrb);
  room.powerups = [];
  room.mines = [];
  room.pulses = [];
  room.feed = [];
  room.lastOrbAt = Date.now();
  room.lastPowerAt = Date.now();

  for (const p of room.players.values()) {
    const spawn = spawnPoint();
    p.x = spawn.x;
    p.y = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.alive = true;
    p.score = 0;
    p.streak = 0;
    p.respawnAt = 0;
    p.mineCd = 0;
    p.pulseCd = 0;
    p.boostUntil = 0;
    p.shieldUntil = 0;
  }
}

function startRound(room) {
  room.inGame = true;
  resetRound(room);
  roomUpdate(room);
  broadcast(room, 'gameStarted');
}

function endRound(room, reason) {
  room.inGame = false;
  const ranking = [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  broadcast(room, 'gameOver', { reason, ranking });
  roomUpdate(room);
}

function circleHit(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

function killPlayer(room, victim, killerName) {
  victim.alive = false;
  victim.respawnAt = Date.now() + 1800;
  victim.streak = 0;
  victim.score = Math.max(0, victim.score - 2);
  room.feed.push(`${victim.name} got shattered by ${killerName}.`);
}

function resolveWalls(p) {
  for (const w of walls) {
    const nearestX = CLAMP(p.x, w.x, w.x + w.w);
    const nearestY = CLAMP(p.y, w.y, w.y + w.h);
    const dx = p.x - nearestX;
    const dy = p.y - nearestY;
    const d2 = dx * dx + dy * dy;
    if (d2 > p.r * p.r) continue;
    const d = Math.sqrt(d2) || 0.0001;
    const overlap = p.r - d;
    const nx = dx / d;
    const ny = dy / d;
    p.x += nx * overlap;
    p.y += ny * overlap;
    p.vx += nx * 40;
    p.vy += ny * 40;
  }
}

wss.on('connection', (ws) => {
  ws.id = id();
  ws.roomCode = null;

  send(ws, 'hello', { id: ws.id, arena: ARENA, tickRate: TICK_RATE, roundTime: ROUND_TIME, winScore: WIN_SCORE, walls });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'host') {
      if (ws.roomCode) return;
      const room = createRoom(ws, msg.name);
      send(ws, 'hosted', { roomCode: room.code });
      roomUpdate(room);
      return;
    }

    if (msg.type === 'join') {
      if (ws.roomCode) return;
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room) return send(ws, 'errorMessage', { message: 'Room not found' });
      addPlayer(room, ws, msg.name);
      room.feed.push(`${msg.name || 'Pilot'} joined.`);
      roomUpdate(room);
      return;
    }

    if (msg.type === 'ping') {
      send(ws, 'pong', { stamp: msg.stamp || Date.now() });
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const player = room.players.get(ws.id);
    if (!player) return;

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 140);
      if (!text) return;
      broadcast(room, 'chat', { from: player.name, text, at: Date.now() });
      return;
    }

    if (msg.type === 'input') {
      player.input = {
        up: !!msg.input?.up,
        down: !!msg.input?.down,
        left: !!msg.input?.left,
        right: !!msg.input?.right,
        action: !!msg.input?.action,
        pulse: !!msg.input?.pulse
      };
      return;
    }

    if (msg.type === 'startGame' && ws.id === room.hostId && room.players.size > 1 && !room.inGame) {
      startRound(room);
    }
  });

  ws.on('close', () => removePlayer(ws));
});

function tick() {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (!room.inGame) {
      while (room.feed.length) broadcast(room, 'notice', { text: room.feed.shift() });
      continue;
    }

    room.timer -= DT;
    if (room.timer <= 0) {
      endRound(room, 'Time expired');
      continue;
    }

    if (now - room.lastOrbAt > 1800 && room.orbs.length < 44) {
      room.orbs.push(createOrb());
      room.lastOrbAt = now;
    }

    if (now - room.lastPowerAt > 6500 && room.powerups.length < 4) {
      room.powerups.push(createPowerup());
      room.lastPowerAt = now;
    }

    const players = [...room.players.values()];

    for (const p of players) {
      if (!p.alive) {
        if (now >= p.respawnAt) {
          const sp = spawnPoint();
          p.x = sp.x;
          p.y = sp.y;
          p.vx = 0;
          p.vy = 0;
          p.alive = true;
        }
        continue;
      }

      const accel = now < p.boostUntil ? 1200 : 920;
      const friction = 0.84;
      const max = now < p.boostUntil ? 470 : 345;
      const inputX = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      const inputY = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      const mag = Math.hypot(inputX, inputY) || 1;

      p.vx += (inputX / mag) * accel * DT;
      p.vy += (inputY / mag) * accel * DT;
      p.vx *= friction;
      p.vy *= friction;

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > max) {
        p.vx = (p.vx / speed) * max;
        p.vy = (p.vy / speed) * max;
      }

      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.x = CLAMP(p.x, p.r, ARENA.width - p.r);
      p.y = CLAMP(p.y, p.r, ARENA.height - p.r);
      resolveWalls(p);

      p.mineCd = Math.max(0, p.mineCd - DT);
      p.pulseCd = Math.max(0, p.pulseCd - DT);

      if (p.input.action && p.mineCd <= 0) {
        room.mines.push({ id: id(), x: p.x, y: p.y, r: 17, ownerId: p.id, endsAt: now + 6000 });
        p.mineCd = 2.2;
      }
      if (p.input.pulse && p.pulseCd <= 0) {
        room.pulses.push({ id: id(), x: p.x, y: p.y, ownerId: p.id, bornAt: now, endsAt: now + 500, radius: 0 });
        p.pulseCd = 4.6;
      }
    }

    for (let i = players.length - 1; i > 0; i -= 1) {
      for (let j = i - 1; j >= 0; j -= 1) {
        const a = players[i];
        const b = players[j];
        if (!a.alive || !b.alive || !circleHit(a, b)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        const overlap = (a.r + b.r - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        a.x += nx * overlap;
        a.y += ny * overlap;
        b.x -= nx * overlap;
        b.y -= ny * overlap;
        a.vx += nx * 85;
        a.vy += ny * 85;
        b.vx -= nx * 85;
        b.vy -= ny * 85;
      }
    }

    room.orbs = room.orbs.filter((orb) => {
      for (const p of players) {
        if (!p.alive) continue;
        if (!circleHit(p, orb)) continue;
        p.score += 1;
        p.streak += 1;
        if (p.streak > 0 && p.streak % 10 === 0) {
          p.score += 2;
          room.feed.push(`${p.name} combo +2!`);
        }
        return false;
      }
      return true;
    });

    room.powerups = room.powerups.filter((pow) => {
      for (const p of players) {
        if (!p.alive || !circleHit(p, pow)) continue;
        if (pow.type === 'boost') p.boostUntil = now + 5500;
        if (pow.type === 'shield') p.shieldUntil = now + 5500;
        if (pow.type === 'pulse') p.pulseCd = 0;
        p.score += 3;
        room.feed.push(`${p.name} grabbed ${pow.type.toUpperCase()}.`);
        return false;
      }
      return true;
    });

    room.mines = room.mines.filter((mine) => {
      if (now >= mine.endsAt) return false;
      for (const p of players) {
        if (!p.alive || p.id === mine.ownerId) continue;
        if (!circleHit(p, mine)) continue;
        const owner = room.players.get(mine.ownerId);
        if (now < p.shieldUntil) {
          room.feed.push(`${p.name} blocked a mine.`);
          return false;
        }
        if (owner) owner.score += 5;
        killPlayer(room, p, owner?.name || 'mine');
        return false;
      }
      return true;
    });

    room.pulses = room.pulses.filter((pulse) => {
      if (now >= pulse.endsAt) return false;
      const age = now - pulse.bornAt;
      pulse.radius = 40 + age * 0.8;
      for (const p of players) {
        if (!p.alive || p.id === pulse.ownerId) continue;
        const dx = p.x - pulse.x;
        const dy = p.y - pulse.y;
        const dist = Math.hypot(dx, dy);
        if (dist > pulse.radius + p.r || dist < 0.1) continue;
        const force = 900 / Math.max(120, dist);
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
      return true;
    });

    const winner = players.find((p) => p.score >= WIN_SCORE);
    if (winner) {
      endRound(room, `${winner.name} reached ${WIN_SCORE}`);
      continue;
    }

    const snapshot = {
      t: now,
      timer: room.timer,
      players: players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        score: p.score,
        alive: p.alive,
        streak: p.streak,
        mineCd: p.mineCd,
        pulseCd: p.pulseCd,
        boost: now < p.boostUntil,
        shield: now < p.shieldUntil,
        respawnAt: p.respawnAt
      })),
      mines: room.mines,
      orbs: room.orbs,
      pulses: room.pulses,
      powerups: room.powerups,
      walls
    };

    broadcast(room, 'snapshot', snapshot);
    while (room.feed.length) broadcast(room, 'notice', { text: room.feed.shift() });
  }
}

setInterval(tick, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Prism Arena server listening on http://0.0.0.0:${PORT}`);
});
