/**
 * WikiRace - server.js
 * Express + Socket.IO server handling all multiplayer game state
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Game State ────────────────────────────────────────────────────────────────

/**
 * rooms: Map<roomCode, RoomState>
 * RoomState {
 *   code: string,
 *   host: socketId,
 *   players: Map<socketId, PlayerState>,
 *   status: 'waiting' | 'playing' | 'finished',
 *   target: string,        // Target article title
 *   targetUrl: string,     // Target Wikipedia URL
 *   startTime: number,
 *   gameTimer: NodeJS.Timeout | null,
 *   timeLimit: number      // seconds
 * }
 *
 * PlayerState {
 *   id: socketId,
 *   name: string,
 *   currentArticle: string,
 *   articlePath: string[],
 *   clicks: number,
 *   finished: boolean,
 *   finishTime: number | null,
 *   rank: number | null
 * }
 */
const rooms = new Map();
let onlineCount = 0;

// Curated list of interesting WikiRace challenges
const RACE_CHALLENGES = [
  { start: 'Adolf Hitler',         target: 'Tea',             startUrl: '/wiki/Adolf_Hitler',         targetUrl: '/wiki/Tea' },
  { start: 'Cleopatra',            target: 'Internet',        startUrl: '/wiki/Cleopatra',             targetUrl: '/wiki/Internet' },
  { start: 'Dinosaur',             target: 'Stock market',    startUrl: '/wiki/Dinosaur',              targetUrl: '/wiki/Stock_market' },
  { start: 'Moon',                 target: 'Pizza',           startUrl: '/wiki/Moon',                  targetUrl: '/wiki/Pizza' },
  { start: 'Ancient Rome',         target: 'Basketball',      startUrl: '/wiki/Ancient_Rome',          targetUrl: '/wiki/Basketball' },
  { start: 'Photosynthesis',       target: 'World War II',    startUrl: '/wiki/Photosynthesis',        targetUrl: '/wiki/World_War_II' },
  { start: 'Black hole',           target: 'Music',           startUrl: '/wiki/Black_hole',            targetUrl: '/wiki/Music' },
  { start: 'Charles Darwin',       target: 'Nuclear weapon',  startUrl: '/wiki/Charles_Darwin',        targetUrl: '/wiki/Nuclear_weapon' },
  { start: 'Shakespeare',          target: 'Quantum mechanics', startUrl: '/wiki/William_Shakespeare', targetUrl: '/wiki/Quantum_mechanics' },
  { start: 'Great Wall of China',  target: 'Jazz',            startUrl: '/wiki/Great_Wall_of_China',   targetUrl: '/wiki/Jazz' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getRoomPublicState(room) {
  const players = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    currentArticle: p.currentArticle,
    articlePath: p.articlePath,
    clicks: p.clicks,
    finished: p.finished,
    finishTime: p.finishTime,
    rank: p.rank,
  }));
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
    players,
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

// ─── Socket.IO Events ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  onlineCount++;
  broadcastOnlineCount();
  console.log(`[+] ${socket.id} connected | total: ${onlineCount}`);

  // ── Create Lobby ──
  socket.on('lobby:create', ({ playerName }) => {
    if (!playerName?.trim()) return socket.emit('error', { msg: 'Name required' });

    const code = generateRoomCode();
    const room = {
      code,
      host: socket.id,
      players: new Map(),
      status: 'waiting',
      target: null,
      targetUrl: null,
      startArticle: null,
      startUrl: null,
      startTime: null,
      gameTimer: null,
      timeLimit: 300, // 5 minutes
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName.trim().slice(0, 20),
      currentArticle: '',
      articlePath: [],
      clicks: 0,
      finished: false,
      finishTime: null,
      rank: null,
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit('lobby:created', { code });
    broadcastRoomState(room);
    console.log(`[ROOM] ${code} created by ${playerName}`);
  });

  // ── Join Lobby ──
  socket.on('lobby:join', ({ roomCode, playerName }) => {
    const code = (roomCode || '').toUpperCase().trim();
    if (!playerName?.trim()) return socket.emit('error', { msg: 'Name required' });
    if (!code) return socket.emit('error', { msg: 'Room code required' });

    const room = rooms.get(code);
    if (!room) return socket.emit('error', { msg: 'Room not found. Check the code and try again.' });
    if (room.status !== 'waiting') return socket.emit('error', { msg: 'Game already in progress.' });
    if (room.players.size >= 8) return socket.emit('error', { msg: 'Room is full (max 8 players).' });

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName.trim().slice(0, 20),
      currentArticle: '',
      articlePath: [],
      clicks: 0,
      finished: false,
      finishTime: null,
      rank: null,
    });

    socket.join(code);
    socket.data.roomCode = code;

    socket.emit('lobby:joined', { code });
    io.to(code).emit('toast', { msg: `${playerName} joined the lobby`, type: 'info' });
    broadcastRoomState(room);
    console.log(`[ROOM] ${code}: ${playerName} joined`);
  });

  // ── Leave Lobby ──
  socket.on('lobby:leave', () => {
    handleLeave(socket);
  });

  // ── Start Game ──
  socket.on('game:start', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { msg: 'Only the host can start.' });
    if (room.players.size < 1) return socket.emit('error', { msg: 'Need at least 1 player.' });
    if (room.status !== 'waiting') return;

    // Pick a random challenge
    const challenge = RACE_CHALLENGES[Math.floor(Math.random() * RACE_CHALLENGES.length)];
    room.target = challenge.target;
    room.targetUrl = challenge.targetUrl;
    room.startArticle = challenge.start;
    room.startUrl = challenge.startUrl;
    room.status = 'playing';
    room.startTime = Date.now();

    // Reset all players
    room.players.forEach(p => {
      p.currentArticle = challenge.start;
      p.articlePath = [challenge.start];
      p.clicks = 0;
      p.finished = false;
      p.finishTime = null;
      p.rank = null;
    });

    broadcastRoomState(room);
    io.to(code).emit('game:starting', {
      startArticle: room.startArticle,
      startUrl: room.startUrl,
      target: room.target,
      targetUrl: room.targetUrl,
      timeLimit: room.timeLimit,
    });

    // Timer tick every second
    room.gameTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - room.startTime) / 1000);
      const remaining = room.timeLimit - elapsed;

      io.to(code).emit('game:tick', { remaining });

      if (remaining <= 0) {
        endGame(room);
      }
    }, 1000);

    console.log(`[GAME] ${code}: started — ${challenge.start} → ${challenge.target}`);
  });

  // ── Player navigates to new article ──
  socket.on('game:navigate', ({ article, url }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    player.currentArticle = article;
    player.articlePath.push(article);
    player.clicks++;

    // Check win condition
    const normalizedArticle = article.toLowerCase().replace(/_/g, ' ').trim();
    const normalizedTarget = room.target.toLowerCase().replace(/_/g, ' ').trim();

    if (normalizedArticle === normalizedTarget || url.includes(room.targetUrl)) {
      player.finished = true;
      player.finishTime = Date.now() - room.startTime;
      const finishedCount = Array.from(room.players.values()).filter(p => p.finished).length;
      player.rank = finishedCount;

      socket.emit('game:won', {
        rank: player.rank,
        clicks: player.clicks,
        time: player.finishTime,
        path: player.articlePath,
      });

      io.to(code).emit('toast', {
        msg: `🏆 ${player.name} reached the target in ${player.clicks} clicks!`,
        type: 'success'
      });

      // Check if all finished
      const allFinished = Array.from(room.players.values()).every(p => p.finished);
      if (allFinished) endGame(room);
    }

    broadcastRoomState(room);
  });

  // ── Play Again (host resets) ──
  socket.on('game:playAgain', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.host !== socket.id) return;

    if (room.gameTimer) clearInterval(room.gameTimer);
    room.status = 'waiting';
    room.target = null;
    room.targetUrl = null;
    room.startArticle = null;
    room.startUrl = null;
    room.startTime = null;
    room.gameTimer = null;

    room.players.forEach(p => {
      p.currentArticle = '';
      p.articlePath = [];
      p.clicks = 0;
      p.finished = false;
      p.finishTime = null;
      p.rank = null;
    });

    io.to(code).emit('game:reset');
    broadcastRoomState(room);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    broadcastOnlineCount();
    handleLeave(socket);
    console.log(`[-] ${socket.id} disconnected | total: ${onlineCount}`);
  });
});

// ─── Game Logic ────────────────────────────────────────────────────────────────

function endGame(room) {
  if (room.status !== 'playing') return;
  if (room.gameTimer) clearInterval(room.gameTimer);

  room.status = 'finished';

  // Build final leaderboard
  const leaderboard = Array.from(room.players.values())
    .map(p => ({
      id: p.id,
      name: p.name,
      clicks: p.clicks,
      finished: p.finished,
      finishTime: p.finishTime,
      rank: p.rank,
      articlePath: p.articlePath,
    }))
    .sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.clicks - a.clicks; // more progress = better
    });

  io.to(room.code).emit('game:over', { leaderboard });
  broadcastRoomState(room);
  console.log(`[GAME] ${room.code}: game over`);
}

function handleLeave(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  const player = room.players.get(socket.id);
  const playerName = player?.name || 'A player';

  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  if (room.players.size === 0) {
    cleanupRoom(code);
    console.log(`[ROOM] ${code}: empty, cleaned up`);
    return;
  }

  // Transfer host if needed
  if (room.host === socket.id) {
    room.host = room.players.keys().next().value;
    const newHost = room.players.get(room.host);
    io.to(code).emit('toast', { msg: `${newHost.name} is now the host`, type: 'info' });
  }

  io.to(code).emit('toast', { msg: `${playerName} left the lobby`, type: 'warning' });
  broadcastRoomState(room);
}

// ─── Start Server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running");
});
