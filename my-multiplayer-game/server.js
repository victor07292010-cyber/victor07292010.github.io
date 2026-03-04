const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const ARENA = { width: 1600, height: 900 };
const ROUND_SECONDS = 180;
const WIN_SCORE = 30;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? randomCode() : code;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randomSpawn() {
  return {
    x: rand(120, ARENA.width - 120),
    y: rand(120, ARENA.height - 120)
  };
}

function createOrb() {
  return { id: cryptoId(), x: rand(80, ARENA.width - 80), y: rand(80, ARENA.height - 80), r: 10 };
}

function createPowerup() {
  const type = Math.random() < 0.5 ? 'boost' : 'shield';
  return { id: cryptoId(), x: rand(100, ARENA.width - 100), y: rand(100, ARENA.height - 100), r: 14, type };
}

function cryptoId() {
  return Math.random().toString(36).slice(2, 10);
}

function roomPublicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    inGame: room.inGame,
    timer: room.timer,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      alive: p.alive
    }))
  };
}

function makeRoom(hostClient, hostName) {
  const code = randomCode();
  const room = {
    code,
    hostId: hostClient.id,
    inGame: false,
    timer: ROUND_SECONDS,
    players: new Map(),
    orbs: [],
    powerups: [],
    mines: [],
    noticeQueue: [],
    lastPowerupSpawn: 0,
    lastOrbFill: 0
  };
  rooms.set(code, room);
  addPlayer(room, hostClient, hostName);
  return room;
}

function addPlayer(room, client, name) {
  const spawn = randomSpawn();
  const player = {
    id: client.id,
    name: String(name || 'Pilot').slice(0, 16),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    r: 18,
    score: 0,
    connected: true,
    alive: true,
    respawnAt: 0,
    mineCooldown: 0,
    boostUntil: 0,
    shieldUntil: 0,
    input: { up: false, down: false, left: false, right: false, action: false }
  };
  room.players.set(client.id, player);
  client.roomCode = room.code;
}

function removePlayer(client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (!room) return;
  const p = room.players.get(client.id);
  if (p) {
    p.connected = false;
    room.noticeQueue.push(`${p.name} left the room.`);
    room.players.delete(client.id);
  }
  if (room.hostId === client.id) {
    const replacement = room.players.values().next().value;
    room.hostId = replacement ? replacement.id : null;
    if (replacement) {
      room.noticeQueue.push(`${replacement.name} is now host.`);
    }
  }
  broadcastRoomUpdate(room);
  if (room.players.size === 0) rooms.delete(room.code);
}

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function broadcast(room, type, data = {}) {
  for (const c of wss.clients) {
    if (c.roomCode === room.code) send(c, type, data);
  }
}

function broadcastRoomUpdate(room) {
  broadcast(room, 'roomUpdate', { room: roomPublicState(room) });
}

function resetRound(room) {
  room.timer = ROUND_SECONDS;
  room.orbs = Array.from({ length: 28 }, createOrb);
  room.powerups = [];
  room.mines = [];
  room.lastPowerupSpawn = Date.now();
  room.lastOrbFill = Date.now();
  for (const p of room.players.values()) {
    const spawn = randomSpawn();
    p.x = spawn.x;
    p.y = spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.score = 0;
    p.alive = true;
    p.respawnAt = 0;
    p.mineCooldown = 0;
    p.boostUntil = 0;
    p.shieldUntil = 0;
  }
}

function startGame(room) {
  room.inGame = true;
  resetRound(room);
  broadcastRoomUpdate(room);
  broadcast(room, 'gameStarted', { room: roomPublicState(room) });
}

function endGame(room, reason) {
  room.inGame = false;
  const ranking = [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  broadcast(room, 'gameOver', { reason, ranking });
  broadcastRoomUpdate(room);
}

wss.on('connection', (ws) => {
  ws.id = cryptoId();
  ws.roomCode = null;

  send(ws, 'welcome', { id: ws.id, arena: ARENA, tickRate: TICK_RATE, roundSeconds: ROUND_SECONDS, winScore: WIN_SCORE });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'host') {
      if (ws.roomCode) return;
      const room = makeRoom(ws, msg.name);
      send(ws, 'hosted', { roomCode: room.code });
      broadcastRoomUpdate(room);
      return;
    }

    if (msg.type === 'join') {
      if (ws.roomCode) return;
      const code = String(msg.roomCode || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(ws, 'errorMessage', { message: 'Room not found.' });
        return;
      }
      addPlayer(room, ws, msg.name);
      room.noticeQueue.push(`${msg.name || 'Pilot'} joined.`);
      broadcastRoomUpdate(room);
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const player = room.players.get(ws.id);
    if (!player) return;

    if (msg.type === 'input') {
      player.input = {
        up: !!msg.input?.up,
        down: !!msg.input?.down,
        left: !!msg.input?.left,
        right: !!msg.input?.right,
        action: !!msg.input?.action
      };
      return;
    }

    if (msg.type === 'startGame' && ws.id === room.hostId && room.players.size > 1 && !room.inGame) {
      startGame(room);
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 140);
      if (!text) return;
      broadcast(room, 'chat', { from: player.name, text, at: Date.now() });
    }
  });

  ws.on('close', () => removePlayer(ws));
});

function circleHit(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

function tick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.inGame) {
      while (room.noticeQueue.length) broadcast(room, 'notice', { text: room.noticeQueue.shift() });
      continue;
    }

    room.timer -= DT;
    if (room.timer <= 0) {
      endGame(room, 'Time up!');
      continue;
    }

    if (now - room.lastOrbFill > 2000 && room.orbs.length < 36) {
      room.orbs.push(createOrb());
      room.lastOrbFill = now;
    }
    if (now - room.lastPowerupSpawn > 7000 && room.powerups.length < 4) {
      room.powerups.push(createPowerup());
      room.lastPowerupSpawn = now;
    }

    const players = [...room.players.values()];

    for (const p of players) {
      if (!p.alive) {
        if (now >= p.respawnAt) {
          const spawn = randomSpawn();
          p.x = spawn.x;
          p.y = spawn.y;
          p.vx = 0;
          p.vy = 0;
          p.alive = true;
        }
        continue;
      }

      const accel = now < p.boostUntil ? 1050 : 820;
      const maxSpeed = now < p.boostUntil ? 460 : 330;
      const friction = 0.86;

      const ax = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      const ay = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      const len = Math.hypot(ax, ay) || 1;

      p.vx += (ax / len) * accel * DT;
      p.vy += (ay / len) * accel * DT;

      p.vx *= friction;
      p.vy *= friction;

      const spd = Math.hypot(p.vx, p.vy);
      if (spd > maxSpeed) {
        p.vx = (p.vx / spd) * maxSpeed;
        p.vy = (p.vy / spd) * maxSpeed;
      }

      p.x += p.vx * DT;
      p.y += p.vy * DT;

      p.x = Math.max(p.r, Math.min(ARENA.width - p.r, p.x));
      p.y = Math.max(p.r, Math.min(ARENA.height - p.r, p.y));

      if (p.mineCooldown > 0) p.mineCooldown -= DT;
      if (p.input.action && p.mineCooldown <= 0) {
        room.mines.push({ id: cryptoId(), x: p.x, y: p.y, r: 16, ownerId: p.id, expiresAt: now + 5500 });
        p.mineCooldown = 2.5;
      }
    }

    for (let i = players.length - 1; i >= 0; i -= 1) {
      for (let j = i - 1; j >= 0; j -= 1) {
        const a = players[i];
        const b = players[j];
        if (!a.alive || !b.alive) continue;
        if (!circleHit(a, b)) continue;
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
        a.vx += nx * 60;
        a.vy += ny * 60;
        b.vx -= nx * 60;
        b.vy -= ny * 60;
      }
    }

    room.orbs = room.orbs.filter((orb) => {
      for (const p of players) {
        if (p.alive && circleHit(p, orb)) {
          p.score += 1;
          return false;
        }
      }
      return true;
    });

    room.powerups = room.powerups.filter((pow) => {
      for (const p of players) {
        if (!p.alive || !circleHit(p, pow)) continue;
        if (pow.type === 'boost') p.boostUntil = now + 6000;
        if (pow.type === 'shield') p.shieldUntil = now + 6000;
        p.score += 2;
        return false;
      }
      return true;
    });

    room.mines = room.mines.filter((mine) => {
      if (now > mine.expiresAt) return false;
      for (const p of players) {
        if (!p.alive || p.id === mine.ownerId) continue;
        if (!circleHit(p, mine)) continue;
        const owner = room.players.get(mine.ownerId);
        if (now >= p.shieldUntil) {
          p.alive = false;
          p.respawnAt = now + 2200;
          if (owner) owner.score += 4;
          p.score = Math.max(0, p.score - 2);
          room.noticeQueue.push(`${p.name} was popped by ${owner ? owner.name : 'a mine'}!`);
        } else {
          room.noticeQueue.push(`${p.name} blocked a mine.`);
        }
        return false;
      }
      return true;
    });

    const leader = players.find((p) => p.score >= WIN_SCORE);
    if (leader) {
      endGame(room, `${leader.name} reached ${WIN_SCORE}!`);
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
        respawnAt: p.respawnAt,
        boost: now < p.boostUntil,
        shield: now < p.shieldUntil,
        mineCooldown: p.mineCooldown
      })),
      orbs: room.orbs,
      powerups: room.powerups,
      mines: room.mines
    };
    broadcast(room, 'snapshot', snapshot);
    while (room.noticeQueue.length) broadcast(room, 'notice', { text: room.noticeQueue.shift() });
  }
}

setInterval(tick, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Neon Room Rush running on http://0.0.0.0:${PORT}`);
});
