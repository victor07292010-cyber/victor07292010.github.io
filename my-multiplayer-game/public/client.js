const dom = {
  homeScreen: document.getElementById('homeScreen'),
  lobbyScreen: document.getElementById('lobbyScreen'),
  gameScreen: document.getElementById('gameScreen'),
  nameInput: document.getElementById('nameInput'),
  hostInput: document.getElementById('hostInput'),
  roomInput: document.getElementById('roomInput'),
  hostBtn: document.getElementById('hostBtn'),
  joinBtn: document.getElementById('joinBtn'),
  homeError: document.getElementById('homeError'),
  roomCodeBadge: document.getElementById('roomCodeBadge'),
  roomLink: document.getElementById('roomLink'),
  playerList: document.getElementById('playerList'),
  startBtn: document.getElementById('startBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  hudRoom: document.getElementById('hudRoom'),
  hudTimer: document.getElementById('hudTimer'),
  hudSelf: document.getElementById('hudSelf'),
  scoreboard: document.getElementById('scoreboard'),
  notice: document.getElementById('notice'),
  chatLog: document.getElementById('chatLog'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  mobileControls: document.getElementById('mobileControls'),
  stickBase: document.getElementById('stickBase'),
  stickKnob: document.getElementById('stickKnob'),
  actionBtn: document.getElementById('actionBtn'),
  canvas: document.getElementById('gameCanvas')
};

const ctx = dom.canvas.getContext('2d');
const state = {
  ws: null,
  id: null,
  roomCode: null,
  hostId: null,
  arena: { width: 1600, height: 900 },
  inGame: false,
  snapshots: [],
  playersMeta: [],
  timer: 0,
  particles: [],
  noticeUntil: 0,
  shake: 0,
  keys: { up: false, down: false, left: false, right: false, action: false },
  touchVec: { x: 0, y: 0 },
  audioCtx: null
};

const palette = ['#56f2ff', '#ffa8fb', '#9fff68', '#ffd84f', '#9db5ff', '#ff8a8a'];

function beep(freq = 440, duration = 0.06, type = 'sine', volume = 0.03) {
  try {
    state.audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = state.audioCtx.createOscillator();
    const g = state.audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = volume;
    o.connect(g).connect(state.audioCtx.destination);
    o.start();
    o.stop(state.audioCtx.currentTime + duration);
  } catch (_) {
    // ignore audio errors
  }
}

function showScreen(which) {
  dom.homeScreen.classList.add('hidden');
  dom.lobbyScreen.classList.add('hidden');
  dom.gameScreen.classList.add('hidden');
  which.classList.remove('hidden');
}

function wsURL(hostRaw) {
  const host = hostRaw.trim() || window.location.host;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}`;
}

function connect() {
  return new Promise((resolve, reject) => {
    dom.homeError.textContent = '';
    const url = wsURL(dom.hostInput.value);
    const ws = new WebSocket(url);
    ws.onopen = () => {
      state.ws = ws;
      resolve();
    };
    ws.onerror = () => reject(new Error('Could not connect to host. Check IP/port.'));
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (state.inGame || state.roomCode) addChat('[system]', 'Disconnected from server');
      state.inGame = false;
      state.roomCode = null;
      state.snapshots = [];
      showScreen(dom.homeScreen);
    };
  });
}

function send(type, data = {}) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type, ...data }));
}

function onMessage(evt) {
  const msg = JSON.parse(evt.data);
  if (msg.type === 'welcome') {
    state.id = msg.id;
    state.arena = msg.arena;
    return;
  }
  if (msg.type === 'hosted') {
    state.roomCode = msg.roomCode;
    dom.roomInput.value = msg.roomCode;
    return;
  }
  if (msg.type === 'roomUpdate') {
    state.playersMeta = msg.room.players;
    state.roomCode = msg.room.code;
    state.hostId = msg.room.hostId;
    state.timer = msg.room.timer;
    dom.roomCodeBadge.textContent = `#${state.roomCode}`;
    const hostForLink = dom.hostInput.value.trim() || window.location.host;
    dom.roomLink.textContent = `Join URL: http://${hostForLink}/?room=${state.roomCode}`;
    dom.hudRoom.textContent = state.roomCode;
    renderLobby(msg.room);
    if (!msg.room.inGame) showScreen(dom.lobbyScreen);
    return;
  }
  if (msg.type === 'gameStarted') {
    state.inGame = true;
    state.snapshots = [];
    showScreen(dom.gameScreen);
    beep(620, 0.12, 'triangle', 0.05);
    return;
  }
  if (msg.type === 'snapshot') {
    const prev = state.snapshots[state.snapshots.length - 1];
    if (prev && prev.players) detectEvents(prev, msg);
    state.snapshots.push(msg);
    if (state.snapshots.length > 25) state.snapshots.shift();
    state.timer = msg.timer;
    return;
  }
  if (msg.type === 'chat') {
    addChat(msg.from, msg.text);
    return;
  }
  if (msg.type === 'notice') {
    showNotice(msg.text);
    return;
  }
  if (msg.type === 'errorMessage') {
    dom.homeError.textContent = msg.message;
    return;
  }
  if (msg.type === 'gameOver') {
    state.inGame = false;
    showNotice(`${msg.reason} Winner: ${msg.ranking[0]?.name ?? 'n/a'}`);
    renderScoreboard(msg.ranking, true);
    beep(240, 0.25, 'sawtooth', 0.07);
  }
}

function renderLobby(room) {
  dom.playerList.innerHTML = '';
  room.players.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `${p.name}${p.id === room.hostId ? ' 👑' : ''}`;
    dom.playerList.appendChild(li);
  });
  const isHost = state.id === room.hostId;
  dom.startBtn.disabled = !isHost || room.players.length < 2 || room.inGame;
}

function detectEvents(prev, curr) {
  const prevMap = new Map(prev.players.map((p) => [p.id, p]));
  for (const p of curr.players) {
    const old = prevMap.get(p.id);
    if (!old) continue;
    if (!old.alive && p.alive) {
      addParticles(p.x, p.y, '#8affde', 14);
      beep(550, 0.08, 'square', 0.03);
    }
    if (old.alive && !p.alive) {
      addParticles(p.x, p.y, '#ff5373', 30);
      state.shake = 9;
      beep(120, 0.16, 'sawtooth', 0.06);
    }
    if (p.score > old.score) beep(880, 0.04, 'triangle', 0.025);
  }
}

function currentRenderState() {
  const renderDelay = 110;
  const t = Date.now() - renderDelay;
  if (state.snapshots.length < 2) return state.snapshots[0];
  let a = state.snapshots[0];
  let b = state.snapshots[state.snapshots.length - 1];
  for (let i = 0; i < state.snapshots.length - 1; i += 1) {
    const s1 = state.snapshots[i];
    const s2 = state.snapshots[i + 1];
    if (s1.t <= t && t <= s2.t) {
      a = s1;
      b = s2;
      break;
    }
  }
  const alpha = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
  const lerp = (x, y) => x + (y - x) * alpha;
  const mapB = new Map(b.players.map((p) => [p.id, p]));
  const players = a.players.map((p1) => {
    const p2 = mapB.get(p1.id) || p1;
    return { ...p1, x: lerp(p1.x, p2.x), y: lerp(p1.y, p2.y), score: p2.score, alive: p2.alive, mineCooldown: p2.mineCooldown, boost: p2.boost, shield: p2.shield, respawnAt: p2.respawnAt };
  });
  return { ...b, players };
}

function playerColor(id) {
  let hash = 0;
  for (const ch of id) hash += ch.charCodeAt(0);
  return palette[hash % palette.length];
}

function draw() {
  requestAnimationFrame(draw);
  if (!state.inGame) return;
  const snap = currentRenderState();
  if (!snap) return;

  const ratio = dom.canvas.clientWidth / state.arena.width;
  dom.canvas.height = Math.round(state.arena.height * ratio);
  const sx = dom.canvas.width / state.arena.width;
  const sy = dom.canvas.height / state.arena.height;

  ctx.save();
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    state.shake *= 0.82;
  }

  ctx.scale(sx, sy);

  // arena grid
  ctx.fillStyle = '#060a16';
  ctx.fillRect(0, 0, state.arena.width, state.arena.height);
  ctx.strokeStyle = 'rgba(100,150,255,0.10)';
  for (let x = 0; x < state.arena.width; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.arena.height); ctx.stroke();
  }
  for (let y = 0; y < state.arena.height; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.arena.width, y); ctx.stroke();
  }

  // entities
  for (const orb of snap.orbs) {
    ctx.fillStyle = '#69f5ff';
    ctx.beginPath(); ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2); ctx.fill();
  }
  for (const p of snap.powerups) {
    ctx.fillStyle = p.type === 'boost' ? '#ffe364' : '#bf93ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillText(p.type === 'boost' ? 'B' : 'S', p.x - 4, p.y + 4);
  }
  for (const m of snap.mines) {
    ctx.strokeStyle = '#ff4d8f';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.stroke();
  }

  for (const p of snap.players) {
    const color = playerColor(p.id);
    if (!p.alive) {
      ctx.fillStyle = 'rgba(180,180,180,.35)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.fill();
      continue;
    }

    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.fill();
    if (p.boost) {
      ctx.strokeStyle = '#ffd95f';
      ctx.beginPath(); ctx.arc(p.x, p.y, 23, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.shield) {
      ctx.strokeStyle = '#b18eff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.id === state.id) {
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 21, 0, Math.PI * 2); ctx.stroke();
    }
  }

  updateParticles();
  renderHUD(snap);
  ctx.restore();
}

function addParticles(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    state.particles.push({ x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, life: 1, color });
  }
}

function updateParticles() {
  for (const p of state.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= 0.025;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillRect(p.x, p.y, 3, 3);
    ctx.globalAlpha = 1;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function renderHUD(snap) {
  dom.hudTimer.textContent = Math.max(0, Math.ceil(state.timer));
  const sorted = [...snap.players].sort((a, b) => b.score - a.score);
  renderScoreboard(sorted, false);
  const me = snap.players.find((p) => p.id === state.id);
  dom.hudSelf.textContent = me ? `${me.score}${me.alive ? '' : ' (respawning...)'}` : '0';
}

function renderScoreboard(list, final = false) {
  dom.scoreboard.innerHTML = `${final ? '<strong>Round Over</strong><br/>' : ''}` + list
    .slice(0, 8)
    .map((p, i) => `${i + 1}. ${p.name || p.id.slice(0, 4)} - <b>${p.score}</b>`)
    .join('<br/>');
}

function showNotice(text) {
  dom.notice.textContent = text;
  dom.notice.style.opacity = '1';
  state.noticeUntil = Date.now() + 2000;
  setTimeout(() => {
    if (Date.now() >= state.noticeUntil) dom.notice.style.opacity = '0';
  }, 2100);
}

function addChat(from, text) {
  const line = document.createElement('div');
  line.className = 'chatLine';
  line.textContent = `${from}: ${text}`;
  dom.chatLog.appendChild(line);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function sendInputLoop() {
  setInterval(() => {
    if (!state.ws || !state.roomCode) return;
    send('input', { input: state.keys });
  }, 33);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') state.keys.up = true;
  if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') state.keys.down = true;
  if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') state.keys.left = true;
  if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') state.keys.right = true;
  if (e.code === 'Space') {
    state.keys.action = true;
    setTimeout(() => { state.keys.action = false; }, 90);
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') state.keys.up = false;
  if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') state.keys.down = false;
  if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') state.keys.left = false;
  if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') state.keys.right = false;
});

function setupMobileControls() {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (!isTouch) return;
  dom.mobileControls.classList.remove('hidden');

  let active = false;
  const center = { x: 59, y: 59 };

  function updateStick(clientX, clientY) {
    const rect = dom.stickBase.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let dx = x - center.x;
    let dy = y - center.y;
    const mag = Math.hypot(dx, dy) || 1;
    const max = 44;
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    dom.stickKnob.style.left = `${center.x - 27 + dx}px`;
    dom.stickKnob.style.top = `${center.y - 27 + dy}px`;

    const normX = dx / max;
    const normY = dy / max;
    state.keys.left = normX < -0.25;
    state.keys.right = normX > 0.25;
    state.keys.up = normY < -0.25;
    state.keys.down = normY > 0.25;
  }

  function resetStick() {
    dom.stickKnob.style.left = '32px';
    dom.stickKnob.style.top = '32px';
    state.keys.up = state.keys.down = state.keys.left = state.keys.right = false;
  }

  dom.stickBase.addEventListener('touchstart', (e) => {
    active = true;
    updateStick(e.touches[0].clientX, e.touches[0].clientY);
  });
  dom.stickBase.addEventListener('touchmove', (e) => {
    if (!active) return;
    updateStick(e.touches[0].clientX, e.touches[0].clientY);
  });
  dom.stickBase.addEventListener('touchend', () => {
    active = false;
    resetStick();
  });

  dom.actionBtn.addEventListener('touchstart', () => {
    state.keys.action = true;
    setTimeout(() => { state.keys.action = false; }, 100);
    beep(200, 0.05, 'square', 0.04);
  });
}

async function beginHost() {
  try {
    if (!state.ws || state.ws.readyState > 1) await connect();
    send('host', { name: dom.nameInput.value || 'Pilot' });
  } catch (err) {
    dom.homeError.textContent = err.message;
  }
}

async function beginJoin() {
  try {
    if (!state.ws || state.ws.readyState > 1) await connect();
    send('join', { name: dom.nameInput.value || 'Pilot', roomCode: dom.roomInput.value.trim().toUpperCase() });
  } catch (err) {
    dom.homeError.textContent = err.message;
  }
}

dom.hostBtn.addEventListener('click', beginHost);
dom.joinBtn.addEventListener('click', beginJoin);
dom.startBtn.addEventListener('click', () => send('startGame'));
dom.leaveBtn.addEventListener('click', () => state.ws?.close());
dom.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = dom.chatInput.value.trim();
  if (!text) return;
  send('chat', { text });
  dom.chatInput.value = '';
});

(function hydrateFromURL() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) dom.roomInput.value = room.toUpperCase();
})();

setupMobileControls();
sendInputLoop();
draw();
showScreen(dom.homeScreen);
