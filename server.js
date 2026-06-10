/**
 * WikiRace - server.js
 * Changes:
 * - RACE_CHALLENGES array with start/target names + Wikipedia URLs (served via API)
 * - First person to reach target wins immediately (game ends on first finish)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve public folder AND root (for favicon in /images/)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// ─── Race Challenges ──────────────────────────────────────────────────────────
// Served to client via /api/challenges so the page can display start/target info
const RACE_CHALLENGES = [
  { start: 'Moon',                 target: 'Pizza',             startUrl: '/wiki/Moon',                  targetUrl: '/wiki/Pizza' },
  { start: 'Cleopatra',            target: 'Internet',          startUrl: '/wiki/Cleopatra',              targetUrl: '/wiki/Internet' },
  { start: 'Dinosaur',             target: 'Stock market',      startUrl: '/wiki/Dinosaur',               targetUrl: '/wiki/Stock_market' },
  { start: 'Ancient Rome',         target: 'Basketball',        startUrl: '/wiki/Ancient_Rome',           targetUrl: '/wiki/Basketball' },
  { start: 'Photosynthesis',       target: 'World War II',      startUrl: '/wiki/Photosynthesis',         targetUrl: '/wiki/World_War_II' },
  { start: 'Black hole',           target: 'Music',             startUrl: '/wiki/Black_hole',             targetUrl: '/wiki/Music' },
  { start: 'Charles Darwin',       target: 'Nuclear weapon',    startUrl: '/wiki/Charles_Darwin',         targetUrl: '/wiki/Nuclear_weapon' },
  { start: 'William Shakespeare',  target: 'Quantum mechanics', startUrl: '/wiki/William_Shakespeare',    targetUrl: '/wiki/Quantum_mechanics' },
  { start: 'Great Wall of China',  target: 'Jazz',              startUrl: '/wiki/Great_Wall_of_China',    targetUrl: '/wiki/Jazz' },
  { start: 'Albert Einstein',      target: 'Football',          startUrl: '/wiki/Albert_Einstein',        targetUrl: '/wiki/Association_football' },
  { start: 'Titanic',              target: 'Photography',       startUrl: '/wiki/Titanic',                targetUrl: '/wiki/Photography' },
  { start: 'Amazon rainforest',    target: 'Television',        startUrl: '/wiki/Amazon_rainforest',      targetUrl: '/wiki/Television' },
  { start: 'Genghis Khan',         target: 'Chess',             startUrl: '/wiki/Genghis_Khan',           targetUrl: '/wiki/Chess' },
  { start: 'Mount Everest',        target: 'Democracy',         startUrl: '/wiki/Mount_Everest',          targetUrl: '/wiki/Democracy' },
  { start: 'Nikola Tesla',         target: 'Coffee',            startUrl: '/wiki/Nikola_Tesla',           targetUrl: '/wiki/Coffee' },
  { start: 'French Revolution',    target: 'Baseball',          startUrl: '/wiki/French_Revolution',      targetUrl: '/wiki/Baseball' },
  { start: 'DNA',                  target: 'Guitar',            startUrl: '/wiki/DNA',                    targetUrl: '/wiki/Guitar' },
  { start: 'Roman Empire',         target: 'Chocolate',         startUrl: '/wiki/Roman_Empire',           targetUrl: '/wiki/Chocolate' },
  { start: 'Isaac Newton',         target: 'Sushi',             startUrl: '/wiki/Isaac_Newton',           targetUrl: '/wiki/Sushi' },
  { start: 'Viking',               target: 'Cinema',            startUrl: '/wiki/Vikings',                targetUrl: '/wiki/Cinema' },
  { start: 'Volcano',              target: 'Olympics',          startUrl: '/wiki/Volcano',                targetUrl: '/wiki/Olympic_Games' },
  { start: 'Napoleon',             target: 'Tennis',            startUrl: '/wiki/Napoleon',               targetUrl: '/wiki/Tennis' },
  { start: 'Shark',                target: 'Piano',             startUrl: '/wiki/Shark',                  targetUrl: '/wiki/Piano' },
  { start: 'Space Shuttle',        target: 'Buddhism',          startUrl: '/wiki/Space_Shuttle',          targetUrl: '/wiki/Buddhism' },
  { start: 'Eiffel Tower',         target: 'Bacteria',          startUrl: '/wiki/Eiffel_Tower',           targetUrl: '/wiki/Bacteria' },
];

// Expose challenges list to client (names only, no URLs needed client-side)
app.get('/api/challenges', (req, res) => {
  res.json(RACE_CHALLENGES.map(c => ({ start: c.start, target: c.target })));
});

// ─── Room State ───────────────────────────────────────────────────────────────
const rooms = new Map();
let onlineCount = 0;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getRoomPublicState(room) {
  return {
    code: room.code,
    host: room.host,
    status: room.status,
    target: room.target,
    targetUrl: room.targetUrl,
    startArticle: room.startArticle,
    startUrl: room.startUrl,
    startTime: room.startTime,
    timeLimit: room.timeLimit,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      currentArticle: p.currentArticle,
      articlePath: p.articlePath,
      clicks: p.clicks,
      finished: p.finished,
      finishTime: p.finishTime,
      rank: p.rank,
    })),
  };
}

function broadcastRoomState(room) {
  io.to(room.code).emit('room:state', getRoomPublicState(room));
}

function cleanupRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    if (room.gameTimer) clearInterval(room.gameTimer);
    rooms.delete(roomCode);
  }
}

function broadcastOnlineCount() {
  io.emit('server:online', { count: onlineCount });
}

// ─── Socket Events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  onlineCount++;
  broadcastOnlineCount();
  console.log(`[+] ${socket.id} connected | total: ${onlineCount}`);

  socket.on('lobby:create', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { msg: 'Name required' });
    const code = generateRoomCode();
    const room = {
      code, host: socket.id,
      players: new Map(),
      status: 'waiting',
      target: null, targetUrl: null,
      startArticle: null, startUrl: null,
      startTime: null, gameTimer: null,
      timeLimit: 999999, // infinite — no time limit
    };
    room.players.set(socket.id, {
      id: socket.id, name: playerName.trim().slice(0, 20),
      currentArticle: '', articlePath: [], clicks: 0,
      finished: false, finishTime: null, rank: null,
    });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('lobby:created', { code });
    broadcastRoomState(room);
    console.log(`[ROOM] ${code} created by ${playerName}`);
  });

  socket.on('lobby:join', ({ roomCode, playerName }) => {
    const code = (roomCode || '').toUpperCase().trim();
    if (!playerName?.trim()) return socket.emit('error', { msg: 'Name required' });
    if (!code) return socket.emit('error', { msg: 'Room code required' });
    const room = rooms.get(code);
    if (!room) return socket.emit('error', { msg: 'Room not found. Check the code and try again.' });
    if (room.status !== 'waiting') return socket.emit('error', { msg: 'Game already in progress.' });
    if (room.players.size >= 8) return socket.emit('error', { msg: 'Room is full (max 8 players).' });
    room.players.set(socket.id, {
      id: socket.id, name: playerName.trim().slice(0, 20),
      currentArticle: '', articlePath: [], clicks: 0,
      finished: false, finishTime: null, rank: null,
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('lobby:joined', { code });
    io.to(code).emit('toast', { msg: `${playerName} joined the lobby`, type: 'info' });
    broadcastRoomState(room);
    console.log(`[ROOM] ${code}: ${playerName} joined`);
  });

  socket.on('lobby:leave', () => handleLeave(socket));

  socket.on('game:start', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { msg: 'Only the host can start.' });
    if (room.status !== 'waiting') return;

    const challenge = RACE_CHALLENGES[Math.floor(Math.random() * RACE_CHALLENGES.length)];
    room.target       = challenge.target;
    room.targetUrl    = challenge.targetUrl;
    room.startArticle = challenge.start;
    room.startUrl     = challenge.startUrl;
    room.status       = 'playing';
    room.startTime    = Date.now();

    room.players.forEach(p => {
      p.currentArticle = challenge.start;
      p.articlePath    = [challenge.start];
      p.clicks         = 0;
      p.finished       = false;
      p.finishTime     = null;
      p.rank           = null;
    });

    broadcastRoomState(room);
    io.to(code).emit('game:starting', {
      startArticle: room.startArticle,
      startUrl:     room.startUrl,
      target:       room.target,
      targetUrl:    room.targetUrl,
      timeLimit:    room.timeLimit,
    });

    room.gameTimer = setInterval(() => {
      const remaining = room.timeLimit - Math.floor((Date.now() - room.startTime) / 1000);
      io.to(code).emit('game:tick', { remaining });
      if (remaining <= 0) endGame(room);
    }, 1000);

    console.log(`[GAME] ${code}: started — ${challenge.start} → ${challenge.target}`);
  });

  // ── Player navigates to a new article ──
  socket.on('game:navigate', ({ article, url }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    player.currentArticle = article;
    player.articlePath.push(article);
    player.clicks++;

    // Normalise both sides for comparison
    const norm = s => decodeURIComponent(s).toLowerCase().replace(/_/g, ' ').trim();
    const targetSlug   = norm(room.targetUrl.replace('/wiki/', ''));
    const incomingSlug = norm((url.split('/wiki/')[1] || article));
    const targetName   = norm(room.target);

    if (incomingSlug === targetSlug || incomingSlug === targetName) {
      // ── FIRST TO FINISH WINS — end game immediately ──
      player.finished   = true;
      player.finishTime = Date.now() - room.startTime;
      player.rank       = 1;

      socket.emit('game:won', {
        rank: 1, clicks: player.clicks,
        time: player.finishTime, path: player.articlePath,
      });

      io.to(code).emit('toast', {
        msg: `🏆 ${player.name} won in ${player.clicks} clicks!`,
        type: 'success',
      });

      endGame(room); // end immediately for everyone
      return;
    }

    broadcastRoomState(room);
  });

  socket.on('game:playAgain', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    if (room.gameTimer) clearInterval(room.gameTimer);
    room.status = 'waiting';
    room.target = room.targetUrl = room.startArticle = room.startUrl = null;
    room.startTime = room.gameTimer = null;
    room.players.forEach(p => {
      p.currentArticle = ''; p.articlePath = []; p.clicks = 0;
      p.finished = false; p.finishTime = null; p.rank = null;
    });
    io.to(code).emit('game:reset');
    broadcastRoomState(room);
  });

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    broadcastOnlineCount();
    handleLeave(socket);
    console.log(`[-] ${socket.id} disconnected | total: ${onlineCount}`);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function endGame(room) {
  if (room.status !== 'playing') return;
  if (room.gameTimer) clearInterval(room.gameTimer);
  room.status = 'finished';

  const leaderboard = Array.from(room.players.values())
    .map(p => ({ id: p.id, name: p.name, clicks: p.clicks, finished: p.finished, finishTime: p.finishTime, rank: p.rank, articlePath: p.articlePath }))
    .sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.clicks - a.clicks;
    });

  const winner = leaderboard.find(p => p.finished) || null;
  io.to(room.code).emit('game:over', { leaderboard, winner });
  broadcastRoomState(room);
  console.log(`[GAME] ${room.code}: game over`);
}

function handleLeave(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const playerName = room.players.get(socket.id)?.name || 'A player';
  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;
  if (room.players.size === 0) { cleanupRoom(code); return; }
  if (room.host === socket.id) {
    room.host = room.players.keys().next().value;
    io.to(code).emit('toast', { msg: `${room.players.get(room.host).name} is now the host`, type: 'info' });
  }
  io.to(code).emit('toast', { msg: `${playerName} left the lobby`, type: 'warning' });
  broadcastRoomState(room);
}

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});