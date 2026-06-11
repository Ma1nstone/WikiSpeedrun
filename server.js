/**
 * SpeedWiki - server.js
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve public folder AND root (for favicon)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// ─── Race Challenges ──────────────────────────────────────────────────────────
const { RACE_CHALLENGES } = require('./RaceChallenges');

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
      timeLimit: 999999, // infinite
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

    // Timer still ticks (used for finish time tracking) but client ignores display
    room.gameTimer = setInterval(() => {
      const remaining = room.timeLimit - Math.floor((Date.now() - room.startTime) / 1000);
      io.to(code).emit('game:tick', { remaining });
    }, 1000);

    console.log(`[GAME] ${code}: started — ${challenge.start} → ${challenge.target}`);
  });

  socket.on('game:navigate', ({ article, url }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || player.finished) return;

    player.currentArticle = article;
    player.articlePath.push(article);
    player.clicks++;

    // Normalise for win check
    const norm = s => decodeURIComponent(s).toLowerCase().replace(/_/g, ' ').trim();
    const targetSlug   = norm(room.targetUrl.replace('/wiki/', ''));
    const incomingSlug = norm((url.split('/wiki/')[1] || article));
    const targetName   = norm(room.target);

    if (incomingSlug === targetSlug || incomingSlug === targetName) {
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

      endGame(room);
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

// ─── Game Logic ───────────────────────────────────────────────────────────────
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