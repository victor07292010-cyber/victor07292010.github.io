const $ = (id) => document.getElementById(id);

const dom = {
  home: $('home'), lobby: $('lobby'), game: $('game'),
  nameInput: $('nameInput'), hostInput: $('hostInput'), roomInput: $('roomInput'),
  hostBtn: $('hostBtn'), joinBtn: $('joinBtn'), startBtn: $('startBtn'), leaveBtn: $('leaveBtn'),
  homeError: $('homeError'), roomBadge: $('roomBadge'), roomLink: $('roomLink'), players: $('players'),
  canvas: $('canvas'), hudRoom: $('hudRoom'), hudTimer: $('hudTimer'), hudScore: $('hudScore'), hudPing: $('hudPing'),
  scoreboard: $('scoreboard'), notice: $('notice'), chatLog: $('chatLog'), chatForm: $('chatForm'), chatInput: $('chatInput'),
  mobile: $('mobile'), stick: $('stick'), knob: $('knob'), mineBtn: $('mineBtn'), pulseBtn: $('pulseBtn')
};

const ctx = dom.canvas.getContext('2d');
const state = {
  ws: null,
  id: null,
  roomCode: null,
  hostId: null,
  arena: { width: 1800, height: 1000 },
  walls: [],
  inGame: false,
  snapshots: [],
  keys: { up: false, down: false, left: false, right: false, action: false, pulse: false },
  particles: [],
  stars: Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() })),
  ping: 0,
  noticeUntil: 0,
  shake: 0,
  audio: null,
  names: new Map()
};

const colors = ['#5ff3ff', '#fca6ff', '#99ff77', '#ffd761', '#9fb0ff', '#ff9f9f'];

function beep(freq = 420, dur = 0.06, type = 'sine', gain = 0.03) {
  try {
    state.audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = state.audio.createOscillator();
    const amp = state.audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    osc.connect(amp).connect(state.audio.destination);
    osc.start();
    osc.stop(state.audio.currentTime + dur);
  } catch {}
}

function show(screen) {
  dom.home.classList.add('hide');
  dom.lobby.classList.add('hide');
  dom.game.classList.add('hide');
  screen.classList.remove('hide');
}

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = dom.hostInput.value.trim() || location.host;
  return `${proto}://${host}`;
}

async function connectIfNeeded() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      state.ws = ws;
      resolve();
    };
    ws.onerror = () => reject(new Error('Could not connect to server'));
    ws.onclose = () => {
      addChat('[system]', 'Disconnected');
      state.inGame = false;
      state.roomCode = null;
      state.snapshots = [];
      show(dom.home);
    };
    ws.onmessage = onMsg;
  });
}

function send(type, data = {}) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type, ...data }));
}

function onMsg(e) {
  const msg = JSON.parse(e.data);

  if (msg.type === 'hello') {
    state.id = msg.id;
    state.arena = msg.arena;
    state.walls = msg.walls || [];
    return;
  }

  if (msg.type === 'hosted') {
    state.roomCode = msg.roomCode;
    dom.roomInput.value = msg.roomCode;
    return;
  }

  if (msg.type === 'roomUpdate') {
    const room = msg.room;
    state.roomCode = room.code;
    state.hostId = room.hostId;
    state.walls = room.walls || state.walls;

    dom.roomBadge.textContent = `#${room.code}`;
    dom.hudRoom.textContent = room.code;

    const hostAddr = dom.hostInput.value.trim() || location.host;
    dom.roomLink.textContent = `Join URL: http://${hostAddr}/?room=${room.code}`;

    dom.players.innerHTML = '';
    room.players.forEach((p) => {
      state.names.set(p.id, p.name);
      const li = document.createElement('li');
      li.textContent = `${p.name} ${p.id === room.hostId ? '👑' : ''}`;
      dom.players.appendChild(li);
    });

    dom.startBtn.disabled = !(state.id === room.hostId && room.players.length > 1 && !room.inGame);
    if (!room.inGame) show(dom.lobby);
    return;
  }

  if (msg.type === 'gameStarted') {
    state.inGame = true;
    state.snapshots = [];
    show(dom.game);
    beep(680, 0.11, 'triangle', 0.05);
    return;
  }

  if (msg.type === 'snapshot') {
    const previous = state.snapshots[state.snapshots.length - 1];
    if (previous) detectEvents(previous, msg);
    state.snapshots.push(msg);
    if (state.snapshots.length > 30) state.snapshots.shift();
    return;
  }

  if (msg.type === 'notice') return notice(msg.text);
  if (msg.type === 'chat') return addChat(msg.from, msg.text);
  if (msg.type === 'pong') {
    state.ping = Math.max(0, Date.now() - msg.stamp);
    dom.hudPing.textContent = String(state.ping);
    return;
  }
  if (msg.type === 'errorMessage') {
    dom.homeError.textContent = msg.message;
    return;
  }

  if (msg.type === 'gameOver') {
    state.inGame = false;
    renderScore(msg.ranking, true);
    notice(`${msg.reason} · Winner: ${msg.ranking[0]?.name || 'none'}`);
    beep(220, 0.25, 'sawtooth', 0.08);
  }
}

function detectEvents(prev, now) {
  const byId = new Map(prev.players.map((p) => [p.id, p]));
  for (const p of now.players) {
    const old = byId.get(p.id);
    if (!old) continue;
    if (old.alive && !p.alive) {
      explode(p.x, p.y, '#ff6a86', 35);
      state.shake = 8;
      beep(130, 0.15, 'sawtooth', 0.05);
    }
    if (!old.alive && p.alive) {
      explode(p.x, p.y, '#72ffe6', 16);
      beep(520, 0.08, 'square', 0.03);
    }
    if (p.score > old.score) beep(900, 0.04, 'triangle', 0.02);
  }
}

function currentSnapshot() {
  if (!state.snapshots.length) return null;
  if (state.snapshots.length === 1) return state.snapshots[0];

  const target = Date.now() - 100;
  let a = state.snapshots[0];
  let b = state.snapshots[state.snapshots.length - 1];

  for (let i = 0; i < state.snapshots.length - 1; i += 1) {
    if (state.snapshots[i].t <= target && target <= state.snapshots[i + 1].t) {
      a = state.snapshots[i];
      b = state.snapshots[i + 1];
      break;
    }
  }

  const blend = Math.min(1, Math.max(0, (target - a.t) / Math.max(1, b.t - a.t)));
  const lerp = (x, y) => x + (y - x) * blend;
  const mapB = new Map(b.players.map((p) => [p.id, p]));
  const players = a.players.map((pa) => {
    const pb = mapB.get(pa.id) || pa;
    return { ...pb, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y) };
  });

  return { ...b, players };
}

function colorFor(id) {
  let h = 0;
  for (const c of id) h += c.charCodeAt(0);
  return colors[h % colors.length];
}

function drawBackground(w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#071027');
  g.addColorStop(1, '#050912');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  for (const s of state.stars) {
    const x = s.x * w;
    const y = s.y * h;
    const r = 0.4 + s.z * 1.6;
    ctx.fillStyle = `rgba(148,178,255,${0.2 + s.z * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(98, 145, 241, 0.12)';
  for (let x = 0; x < state.arena.width; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.arena.height);
    ctx.stroke();
  }
  for (let y = 0; y < state.arena.height; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.arena.width, y);
    ctx.stroke();
  }
}

function draw() {
  requestAnimationFrame(draw);
  if (!state.inGame) return;

  const snap = currentSnapshot();
  if (!snap) return;

  const ratio = dom.canvas.clientWidth / state.arena.width;
  dom.canvas.height = Math.round(state.arena.height * ratio);

  const sx = dom.canvas.width / state.arena.width;
  const sy = dom.canvas.height / state.arena.height;

  ctx.save();
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    state.shake *= 0.84;
  }

  ctx.scale(sx, sy);
  drawBackground(dom.canvas.width, dom.canvas.height);

  for (const w of state.walls) {
    ctx.fillStyle = '#122343';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = '#4b75c9';
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  }

  snap.orbs.forEach((o) => {
    const pulse = (Math.sin((Date.now() * 0.004) + o.glow * 10) + 1) * 0.5;
    const rr = o.r + pulse * 2;
    const grad = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, rr + 10);
    grad.addColorStop(0, '#c8fbff');
    grad.addColorStop(1, 'rgba(95,239,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(o.x, o.y, rr + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#60f0ff';
    ctx.beginPath();
    ctx.arc(o.x, o.y, rr, 0, Math.PI * 2);
    ctx.fill();
  });

  snap.powerups.forEach((p) => {
    const col = p.type === 'boost' ? '#ffd462' : p.type === 'shield' ? '#bd91ff' : '#6cb7ff';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a1327';
    ctx.font = 'bold 12px sans-serif';
    const text = p.type === 'boost' ? 'B' : p.type === 'shield' ? 'S' : 'P';
    ctx.fillText(text, p.x - 4, p.y + 4);
  });

  snap.mines.forEach((m) => {
    ctx.strokeStyle = '#ff5c8c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.stroke();
  });

  snap.pulses.forEach((p) => {
    ctx.strokeStyle = 'rgba(121,170,255,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  snap.players.forEach((p) => {
    if (!p.alive) {
      ctx.fillStyle = 'rgba(175,175,175,0.25)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 19, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const c = colorFor(p.id);

    const glow = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 26);
    glow.addColorStop(0, c);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 19, 0, Math.PI * 2);
    ctx.fill();

    if (p.boost) {
      ctx.strokeStyle = '#ffe072';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.shield) {
      ctx.strokeStyle = '#b68fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 29, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p.id === state.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  renderParticles();
  updateHUD(snap);
  ctx.restore();
}

function explode(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    state.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      life: 1,
      color
    });
  }
}

function renderParticles() {
  for (const p of state.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= 0.03;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
    ctx.globalAlpha = 1;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function updateHUD(snap) {
  dom.hudTimer.textContent = String(Math.max(0, Math.ceil(snap.timer)));
  const me = snap.players.find((p) => p.id === state.id);
  dom.hudScore.textContent = me ? `${me.score}${me.alive ? '' : ' (respawn)'}` : '0';

  const rank = [...snap.players]
    .map((p) => ({ ...p, name: state.names.get(p.id) || p.id.slice(0, 4) }))
    .sort((a, b) => b.score - a.score);

  renderScore(rank, false);
}

function renderScore(rank, final) {
  dom.scoreboard.innerHTML = `${final ? '<b>Round Over</b><br />' : ''}` + rank.slice(0, 8)
    .map((p, i) => `${i + 1}. ${p.name} <b>${p.score}</b>`) 
    .join('<br />');
}

function notice(text) {
  dom.notice.textContent = text;
  dom.notice.style.opacity = '1';
  state.noticeUntil = Date.now() + 1900;
  setTimeout(() => {
    if (Date.now() >= state.noticeUntil) dom.notice.style.opacity = '0';
  }, 2000);
}

function addChat(from, text) {
  const line = document.createElement('div');
  line.className = 'chatLine';
  line.textContent = `${from}: ${text}`;
  dom.chatLog.appendChild(line);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function bindKeyboard() {
  const set = (down) => (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') state.keys.up = down;
    if (k === 's' || e.key === 'ArrowDown') state.keys.down = down;
    if (k === 'a' || e.key === 'ArrowLeft') state.keys.left = down;
    if (k === 'd' || e.key === 'ArrowRight') state.keys.right = down;
    if (e.code === 'Space') {
      if (down) {
        state.keys.action = true;
        setTimeout(() => { state.keys.action = false; }, 90);
      }
    }
    if (k === 'e') {
      if (down) {
        state.keys.pulse = true;
        setTimeout(() => { state.keys.pulse = false; }, 90);
      }
    }
  };
  addEventListener('keydown', set(true));
  addEventListener('keyup', set(false));
}

function bindMobile() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  dom.mobile.classList.remove('hide');

  const center = { x: 60, y: 60 };
  let touching = false;

  const updateStick = (cx, cy) => {
    const r = dom.stick.getBoundingClientRect();
    let dx = cx - r.left - center.x;
    let dy = cy - r.top - center.y;
    const max = 45;
    const mag = Math.hypot(dx, dy) || 1;
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    dom.knob.style.left = `${33 + dx}px`;
    dom.knob.style.top = `${33 + dy}px`;

    state.keys.left = dx < -12;
    state.keys.right = dx > 12;
    state.keys.up = dy < -12;
    state.keys.down = dy > 12;
  };

  const resetStick = () => {
    dom.knob.style.left = '33px';
    dom.knob.style.top = '33px';
    state.keys.left = state.keys.right = state.keys.up = state.keys.down = false;
  };

  dom.stick.addEventListener('touchstart', (e) => {
    touching = true;
    updateStick(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  dom.stick.addEventListener('touchmove', (e) => {
    if (touching) updateStick(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  dom.stick.addEventListener('touchend', () => {
    touching = false;
    resetStick();
  });

  dom.mineBtn.addEventListener('touchstart', () => {
    state.keys.action = true;
    setTimeout(() => { state.keys.action = false; }, 100);
    beep(240, 0.05, 'square', 0.04);
  }, { passive: true });

  dom.pulseBtn.addEventListener('touchstart', () => {
    state.keys.pulse = true;
    setTimeout(() => { state.keys.pulse = false; }, 100);
    beep(520, 0.05, 'triangle', 0.04);
  }, { passive: true });
}

async function startHost() {
  dom.homeError.textContent = '';
  try {
    await connectIfNeeded();
    send('host', { name: dom.nameInput.value.trim() || 'Pilot' });
  } catch (err) {
    dom.homeError.textContent = err.message;
  }
}

async function startJoin() {
  dom.homeError.textContent = '';
  try {
    await connectIfNeeded();
    send('join', { name: dom.nameInput.value.trim() || 'Pilot', roomCode: dom.roomInput.value.trim().toUpperCase() });
  } catch (err) {
    dom.homeError.textContent = err.message;
  }
}

function loops() {
  setInterval(() => {
    if (!state.roomCode) return;
    send('input', { input: state.keys });
  }, 33);

  setInterval(() => {
    if (!state.roomCode) return;
    send('ping', { stamp: Date.now() });
  }, 1500);
}

function init() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) dom.roomInput.value = room.toUpperCase();

  dom.hostBtn.addEventListener('click', startHost);
  dom.joinBtn.addEventListener('click', startJoin);
  dom.startBtn.addEventListener('click', () => send('startGame'));
  dom.leaveBtn.addEventListener('click', () => state.ws?.close());
  dom.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = dom.chatInput.value.trim();
    if (!text) return;
    send('chat', { text });
    dom.chatInput.value = '';
  });

  bindKeyboard();
  bindMobile();
  loops();
  draw();
  show(dom.home);
}

init();
