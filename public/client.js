/**
 * WikiRace — client.js
 * Fixed bugs:
 *  1. Online count IDs corrected (home-online-count, lobby-online-count)
 *  2. Join modal now shows/hides the room-code input field
 *  3. btn-start-game handler moved inside DOMContentLoaded
 *  4. room:state safely skips lobby DOM updates when not on lobby screen
 *  5. Full game-over leaderboard with proper styling
 *  6. Path trail updates on each navigation
 *  7. Toast system wired up
 *  8. Play Again + Leave buttons wired up
 *  9. Copy room code button wired up
 * 10. Countdown overlay before game starts
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let roomCode   = null;
let isHost     = false;
let playerName = "";
let clickCount = 0;
let myPath     = [];
let joining    = false;

// ─── Online count (fix: update BOTH elements by id) ──────────────────────────
socket.on("server:online", ({ count }) => {
  const home  = document.getElementById("home-online-count");
  const lobby = document.getElementById("lobby-online-count");
  if (home)  home.textContent  = count;
  if (lobby) lobby.textContent = count;
});

// ─── Screen switching ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.add("hidden");
    s.classList.remove("active");
  });
  const screen = document.getElementById(`screen-${name}`);
  if (!screen) return;
  screen.classList.remove("hidden");
  screen.classList.add("active");
}

// ─── Toast notifications ──────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "toastOut .25s forwards";
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

socket.on("toast", ({ msg, type }) => showToast(msg, type));

// ─── Modal: open with correct mode ───────────────────────────────────────────
function openNameModal(isJoin) {
  joining = isJoin;
  const codeGroup = document.getElementById("join-code-group");
  const title     = document.getElementById("modal-name-title");
  const sub       = document.getElementById("modal-name-sub");
  const codeInput = document.getElementById("input-room-code");

  if (isJoin) {
    title.textContent = "Join a Lobby";
    sub.textContent   = "Enter your name and the room code.";
    codeGroup.classList.remove("hidden");
    if (codeInput) codeInput.value = "";
  } else {
    title.textContent = "Create a Lobby";
    sub.textContent   = "You'll appear with this name in the lobby.";
    codeGroup.classList.add("hidden");
  }

  document.getElementById("input-name").value = "";
  document.getElementById("modal-name").classList.remove("hidden");
  setTimeout(() => document.getElementById("input-name").focus(), 50);
}

// ─── DOM Ready ────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {

  // Home buttons
  document.getElementById("btn-create").onclick      = () => openNameModal(false);
  document.getElementById("btn-join-open").onclick   = () => openNameModal(true);
  document.getElementById("btn-how-to-play").onclick = () =>
    document.getElementById("modal-how").classList.remove("hidden");
  document.getElementById("btn-how-close").onclick   = () =>
    document.getElementById("modal-how").classList.add("hidden");

  // Modal cancel
  document.getElementById("btn-modal-cancel").onclick = () =>
    document.getElementById("modal-name").classList.add("hidden");

  // Modal confirm — validate then create or join
  document.getElementById("btn-modal-confirm").onclick = confirmModal;
  document.getElementById("input-name").addEventListener("keydown", e => {
    if (e.key === "Enter") confirmModal();
  });
  const codeInput = document.getElementById("input-room-code");
  if (codeInput) {
    codeInput.addEventListener("keydown", e => {
      if (e.key === "Enter") confirmModal();
    });
    // Auto-uppercase room code as typed
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase();
    });
  }

  // Copy room code button
  document.getElementById("btn-copy-code").onclick = () => {
    const code = document.getElementById("lobby-code-value").textContent;
    navigator.clipboard.writeText(code).then(() => showToast("Room code copied!", "success"));
  };

  // Start game (host only) — fixed: now inside DOMContentLoaded
  document.getElementById("btn-start-game").onclick = () => {
    socket.emit("game:start");
  };

  // Leave lobby
  document.getElementById("btn-leave-lobby").onclick = () => {
    socket.emit("lobby:leave");
    showScreen("home");
    roomCode = null;
    isHost   = false;
  };

  // Game over: Play Again (host)
  document.getElementById("btn-play-again").onclick = () => {
    socket.emit("game:playAgain");
  };

  // Game over: Leave
  document.getElementById("btn-gameover-leave").onclick = () => {
    socket.emit("lobby:leave");
    document.getElementById("overlay-gameover").classList.add("hidden");
    showScreen("home");
    roomCode = null;
    isHost   = false;
  };

});

function confirmModal() {
  playerName = document.getElementById("input-name").value.trim();
  if (!playerName) { showToast("Please enter your name", "error"); return; }

  if (joining) {
    const codeEl = document.getElementById("input-room-code");
    const code = (codeEl ? codeEl.value : "").trim().toUpperCase();
    if (!code) { showToast("Please enter a room code", "error"); return; }
    document.getElementById("modal-name").classList.add("hidden");
    joinLobby(code);
  } else {
    document.getElementById("modal-name").classList.add("hidden");
    createLobby();
  }
}

// ─── Lobby system ─────────────────────────────────────────────────────────────
function createLobby() { socket.emit("lobby:create", { playerName }); }
function joinLobby(code) { socket.emit("lobby:join", { roomCode: code, playerName }); }

socket.on("lobby:created", ({ code }) => {
  roomCode = code;
  isHost   = true;
  document.getElementById("lobby-code-value").textContent = roomCode;
  showScreen("lobby");
});

socket.on("lobby:joined", ({ code }) => {
  roomCode = code;
  isHost   = false;
  document.getElementById("lobby-code-value").textContent = roomCode;
  showScreen("lobby");
});

socket.on("error", ({ msg }) => showToast(msg, "error"));

// ─── Room state update ────────────────────────────────────────────────────────
socket.on("room:state", (room) => {
  // Update lobby player list only if lobby screen is visible
  const lobbyScreen = document.getElementById("screen-lobby");
  if (lobbyScreen && !lobbyScreen.classList.contains("hidden")) {
    const list = document.getElementById("lobby-player-list");
    list.innerHTML = "";
    document.getElementById("lobby-player-count").textContent = `${room.players.length}/8`;

    room.players.forEach(p => {
      const li = document.createElement("li");
      li.className = "player-list-item";

      // Coloured avatar
      const avatar = document.createElement("div");
      avatar.className = "player-avatar";
      avatar.style.background = avatarColor(p.name);
      avatar.textContent = p.name.charAt(0).toUpperCase();

      const nameEl = document.createElement("span");
      nameEl.className = "player-name";
      nameEl.textContent = p.name;

      li.appendChild(avatar);
      li.appendChild(nameEl);

      if (p.id === room.host) {
        const badge = document.createElement("span");
        badge.className = "badge-host";
        badge.textContent = "Host";
        li.appendChild(badge);
      }
      if (p.id === socket.id) {
        const you = document.createElement("span");
        you.className = "badge-you";
        you.textContent = "You";
        li.appendChild(you);
      }

      list.appendChild(li);
    });

    // Show/hide host controls
    const startBtn    = document.getElementById("btn-start-game");
    const waitingMsg  = document.getElementById("lobby-waiting-msg");
    if (socket.id === room.host) {
      startBtn.classList.remove("hidden");
      waitingMsg.classList.add("hidden");
      isHost = true;
    } else {
      startBtn.classList.add("hidden");
      waitingMsg.classList.remove("hidden");
      isHost = false;
    }
  }

  // Keep scoreboard updated during game
  const gameScreen = document.getElementById("screen-game");
  if (gameScreen && !gameScreen.classList.contains("hidden")) {
    updateScoreboard(room.players, room.host);
  }
});

// ─── Scoreboard ───────────────────────────────────────────────────────────────
function updateScoreboard(players, host) {
  const list = document.getElementById("game-scoreboard");
  if (!list) return;
  list.innerHTML = "";

  // Sort: finished first (by time), then by clicks desc
  const sorted = [...players].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    return b.clicks - a.clicks;
  });

  sorted.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "score-item" +
      (p.finished ? " score-finished" : "") +
      (p.id === socket.id ? " score-you" : "");

    const rank = document.createElement("span");
    rank.className = "score-rank";
    rank.textContent = i + 1;

    const av = document.createElement("div");
    av.className = "score-avatar";
    av.style.background = avatarColor(p.name);
    av.textContent = p.name.charAt(0).toUpperCase();

    const info = document.createElement("div");
    info.className = "score-info";
    const nameEl = document.createElement("div");
    nameEl.className = "score-name";
    nameEl.textContent = p.name + (p.id === socket.id ? " (you)" : "");
    const articleEl = document.createElement("div");
    articleEl.className = "score-article";
    articleEl.textContent = p.finished ? "✓ Finished!" : (p.currentArticle || "—");
    info.appendChild(nameEl);
    info.appendChild(articleEl);

    const clicks = document.createElement("span");
    clicks.className = p.finished ? "score-done-badge" : "score-clicks";
    clicks.textContent = p.finished ? "Done" : `${p.clicks}`;

    li.appendChild(rank);
    li.appendChild(av);
    li.appendChild(info);
    li.appendChild(clicks);
    list.appendChild(li);
  });
}

// ─── Game starting: countdown then load ──────────────────────────────────────
socket.on("game:starting", (data) => {
  clickCount = 0;
  myPath     = [];
  document.getElementById("game-target-name").textContent = data.target;
  document.getElementById("game-click-count").textContent = "0";
  document.getElementById("path-trail").innerHTML = "";

  // Show countdown overlay
  const overlay   = document.getElementById("overlay-countdown");
  const numEl     = document.getElementById("countdown-number");
  const startEl   = document.getElementById("countdown-start");
  const targetEl  = document.getElementById("countdown-target");

  startEl.textContent  = data.startArticle;
  targetEl.textContent = data.target;
  overlay.classList.remove("hidden");
  showScreen("game");

  let count = 3;
  numEl.textContent = count;

  const tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(tick);
      overlay.classList.add("hidden");
      loadWikipedia(data.startUrl, data.startArticle);
    } else {
      numEl.textContent = count;
      numEl.style.animation = "none";
      void numEl.offsetWidth; // reflow to restart animation
      numEl.style.animation = "";
    }
  }, 1000);
});

// ─── Wikipedia loader ─────────────────────────────────────────────────────────
async function loadWikipedia(url, articleTitle) {
  const loading = document.getElementById("wiki-loading");
  loading.classList.remove("hidden");

  const title = url.split("/wiki/")[1];

  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${title}`);
    if (!res.ok) throw new Error("Fetch failed");
    const html = await res.text();

    const frame = document.getElementById("wiki-frame");

    // Inject CSS to hide Wikipedia chrome and style links
    const injectCSS = `
      <style>
        body { font-family: -apple-system, 'Linux Libertine', Georgia, serif; padding: 16px 24px; max-width: 960px; margin: 0 auto; }
        .mw-header, .mw-navigation, #mw-head, #mw-panel, #footer, .navbox,
        .noprint, .mw-portlet, #siteSub, #contentSub, .mw-indicators,
        .catlinks, #toc ~ .mw-editsection, .mw-editsection,
        #coordinates, .sistersitebox { display: none !important; }
        a[href^="/wiki/"] { color: #3366CC; text-decoration: none; }
        a[href^="/wiki/"]:hover { text-decoration: underline; }
        a[href^="http"], a[href^="//"], a[href^="#cite"], a[href*="Special:"],
        a[href*="Wikipedia:"], a[href*="Help:"], a[href*="Talk:"],
        a[href*="User:"], a[href*="File:"], a[href*="Category:"],
        a[href*="Portal:"], a[href*="Template:"] { pointer-events: none; opacity: 0.5; }
        img { max-width: 100%; height: auto; }
        .infobox { float: right; margin: 0 0 16px 24px; max-width: 320px; font-size: .85em; border: 1px solid #EAECF0; border-radius: 6px; padding: 10px; }
        h1 { font-size: 2rem; border-bottom: 1px solid #EAECF0; padding-bottom: 8px; margin-bottom: 16px; }
        p { line-height: 1.65; margin-bottom: 12px; }
      </style>
    `;

    frame.srcdoc = `<base href="https://en.wikipedia.org/wiki/">${injectCSS}${html}`;

    const displayTitle = articleTitle ||
      decodeURIComponent(title.replace(/_/g, " "));

    document.getElementById("game-current-article").textContent = displayTitle;
    loading.classList.add("hidden");

    enableLinkTracking(frame);
  } catch (err) {
    loading.classList.add("hidden");
    showToast("Failed to load article, try another link", "error");
  }
}

// ─── Link tracking ────────────────────────────────────────────────────────────
function enableLinkTracking(frame) {
  // Use onload so the srcdoc has fully rendered
  frame.onload = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      doc.addEventListener("click", (e) => {
        const a = e.target.closest("a");
        if (!a) return;

        const href = a.getAttribute("href");
        if (!href) return;

        // Only allow /wiki/ article links; block everything else
        if (!href.startsWith("/wiki/")) {
          e.preventDefault();
          return;
        }

        // Block non-article namespaces
        const blocked = ["Special:", "Wikipedia:", "Help:", "Talk:", "User:",
                         "File:", "Category:", "Portal:", "Template:", "Draft:"];
        const articlePart = decodeURIComponent(href.split("/wiki/")[1] || "");
        if (blocked.some(ns => articlePart.startsWith(ns))) {
          e.preventDefault();
          return;
        }

        e.preventDefault();

        clickCount++;
        document.getElementById("game-click-count").textContent = clickCount;

        const displayName = articlePart.replace(/_/g, " ");
        document.getElementById("game-current-article").textContent = displayName;

        // Update path trail
        myPath.push(displayName);
        updatePathTrail();

        socket.emit("game:navigate", {
          article: displayName,
          url: href
        });

        loadWikipedia(href, displayName);
      });
    } catch (err) {
      console.warn("Link tracking error:", err);
    }
  };
}

// ─── Path trail ───────────────────────────────────────────────────────────────
function updatePathTrail() {
  const trail = document.getElementById("path-trail");
  if (!trail) return;
  trail.innerHTML = "";

  myPath.forEach((article, i) => {
    if (i > 0) {
      const arrow = document.createElement("span");
      arrow.className = "trail-arrow";
      arrow.textContent = "›";
      trail.appendChild(arrow);
    }
    const pill = document.createElement("span");
    pill.className = "trail-pill" + (i === myPath.length - 1 ? " trail-current" : "");
    pill.textContent = article;
    trail.appendChild(pill);
  });

  // Scroll to end
  trail.scrollLeft = trail.scrollWidth;
}

// ─── Timer ────────────────────────────────────────────────────────────────────
socket.on("game:tick", ({ remaining }) => {
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  const el  = document.getElementById("timer-value");
  if (el) el.textContent = `${min}:${sec.toString().padStart(2, "0")}`;

  // Urgent styling under 60s
  const timerBox = document.getElementById("game-timer");
  if (timerBox) {
    if (remaining <= 60) timerBox.classList.add("urgent");
    else                 timerBox.classList.remove("urgent");
  }
});

// ─── Win notification ─────────────────────────────────────────────────────────
socket.on("game:won", ({ rank, clicks, time }) => {
  const ms = time;
  const s  = Math.floor(ms / 1000);
  const m  = Math.floor(s / 60);
  const timeStr = `${m}:${(s % 60).toString().padStart(2,"0")}`;
  showToast(`🏆 You finished #${rank} in ${clicks} clicks (${timeStr})!`, "success");
});

// ─── Game over overlay ────────────────────────────────────────────────────────
socket.on("game:over", ({ leaderboard }) => {
  const overlay = document.getElementById("overlay-gameover");
  const list    = document.getElementById("gameover-leaderboard");
  const title   = document.getElementById("gameover-title");
  const result  = document.getElementById("gameover-your-result");
  const playBtn = document.getElementById("btn-play-again");

  list.innerHTML = "";
  overlay.classList.remove("hidden");

  // Find my rank
  const me = leaderboard.find(p => p.id === socket.id);
  if (me && me.finished) {
    result.textContent = me.rank === 1 ? "🏆" : me.rank === 2 ? "🥈" : me.rank === 3 ? "🥉" : "🎉";
    title.textContent  = me.rank === 1 ? "You Won!" : `You placed #${me.rank}`;
  } else {
    result.textContent = "⏱️";
    title.textContent  = "Time's Up!";
  }

  const rankEmojis = ["🥇", "🥈", "🥉"];

  leaderboard.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "gameover-item" + (i < 3 ? ` podium-${i+1}` : "");

    const rankEl = document.createElement("span");
    rankEl.className = "gameover-rank-emoji";
    rankEl.textContent = rankEmojis[i] || `#${i+1}`;

    const nameEl = document.createElement("span");
    nameEl.className = "gameover-player-name";
    nameEl.textContent = p.name + (p.id === socket.id ? " (you)" : "");

    const statsEl = document.createElement("span");
    statsEl.className = p.finished ? "gameover-player-stats" : "gameover-dnf";
    if (p.finished) {
      const s = Math.floor(p.finishTime / 1000);
      statsEl.textContent = `${p.clicks} clicks · ${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
    } else {
      statsEl.textContent = "Did not finish";
    }

    li.appendChild(rankEl);
    li.appendChild(nameEl);
    li.appendChild(statsEl);
    list.appendChild(li);
  });

  // Show play again only to host
  if (isHost) playBtn.classList.remove("hidden");
  else        playBtn.classList.add("hidden");
});

// ─── Play again: return to lobby ─────────────────────────────────────────────
socket.on("game:reset", () => {
  document.getElementById("overlay-gameover").classList.add("hidden");
  showScreen("lobby");
});

// ─── Avatar color generator (deterministic from name) ────────────────────────
const AVATAR_COLORS = [
  "#3366CC","#2E7D32","#6A1B9A","#C62828","#AD6800",
  "#00695C","#1565C0","#4527A0","#558B2F","#BF360C"
];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
