/**
 * SpeedWiki — client.js
 * Fixes:
 *  - Infinite time (no timer)
 *  - Click counter fixed (back doesn't add clicks, only forward navigation does)
 *  - Wikipedia rendered via ?action=render for real Wikipedia look
 *  - Search bar punishment: 30s Chinese language switch
 *  - Win screen shows winner's path to everyone
 *  - First to reach target wins, game ends for all
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let roomCode      = null;
let isHost        = false;
let playerName    = "";
let clickCount    = 0;
let myPath        = [];      // [{ title, url }, ...]
let joining       = false;
let gameTarget    = null;
let gameTargetUrl = null;
let punished      = false;   // currently in Chinese punishment
let punishTimer   = null;

// ─── Online count ─────────────────────────────────────────────────────────────
socket.on("server:online", ({ count }) => {
  const home  = document.getElementById("home-online-count");
  const lobby = document.getElementById("lobby-online-count");
  if (home)  home.textContent = count;
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

// ─── Toast ────────────────────────────────────────────────────────────────────
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
  }, 3500);
}
socket.on("toast", ({ msg, type }) => showToast(msg, type));

// ─── Challenge preview on home ────────────────────────────────────────────────
async function loadChallengePreview() {
  try {
    const res = await fetch('/api/challenges');
    const challenges = await res.json();
    const c = challenges[Math.floor(Math.random() * challenges.length)];
    const startEl  = document.getElementById("preview-start");
    const targetEl = document.getElementById("preview-target-name");
    if (startEl)  startEl.textContent  = c.start;
    if (targetEl) targetEl.textContent = c.target;
  } catch (e) {}
}

// ─── Modal ────────────────────────────────────────────────────────────────────
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
  loadChallengePreview();

  document.getElementById("btn-create").onclick      = () => openNameModal(false);
  document.getElementById("btn-join-open").onclick   = () => openNameModal(true);
  document.getElementById("btn-how-to-play").onclick = () =>
    document.getElementById("modal-how").classList.remove("hidden");
  document.getElementById("btn-how-close").onclick   = () =>
    document.getElementById("modal-how").classList.add("hidden");
  document.getElementById("btn-modal-cancel").onclick = () =>
    document.getElementById("modal-name").classList.add("hidden");
  document.getElementById("btn-modal-confirm").onclick = confirmModal;

  document.getElementById("input-name").addEventListener("keydown", e => {
    if (e.key === "Enter") confirmModal();
  });
  const codeInput = document.getElementById("input-room-code");
  if (codeInput) {
    codeInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmModal(); });
    codeInput.addEventListener("input", () => { codeInput.value = codeInput.value.toUpperCase(); });
  }

  document.getElementById("btn-copy-code").onclick = () => {
    const code = document.getElementById("lobby-code-value").textContent;
    navigator.clipboard.writeText(code).then(() => showToast("Room code copied!", "success"));
  };

  document.getElementById("btn-start-game").onclick = () => socket.emit("game:start");

  document.getElementById("btn-leave-lobby").onclick = () => {
    socket.emit("lobby:leave");
    showScreen("home");
    roomCode = null; isHost = false;
  };

  document.getElementById("btn-back").onclick = () => goBack();
  document.getElementById("btn-play-again").onclick = () => socket.emit("game:playAgain");

  document.getElementById("btn-gameover-leave").onclick = () => {
    socket.emit("lobby:leave");
    document.getElementById("overlay-gameover").classList.add("hidden");
    showScreen("home");
    roomCode = null; isHost = false;
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

// ─── Lobby ────────────────────────────────────────────────────────────────────
function createLobby() { socket.emit("lobby:create", { playerName }); }
function joinLobby(code) { socket.emit("lobby:join", { roomCode: code, playerName }); }

socket.on("lobby:created", ({ code }) => {
  roomCode = code; isHost = true;
  document.getElementById("lobby-code-value").textContent = roomCode;
  showScreen("lobby");
});
socket.on("lobby:joined", ({ code }) => {
  roomCode = code; isHost = false;
  document.getElementById("lobby-code-value").textContent = roomCode;
  showScreen("lobby");
});
socket.on("error", ({ msg }) => showToast(msg, "error"));

// ─── Room state ───────────────────────────────────────────────────────────────
socket.on("room:state", (room) => {
  const lobbyScreen = document.getElementById("screen-lobby");
  if (lobbyScreen && !lobbyScreen.classList.contains("hidden")) {
    const list = document.getElementById("lobby-player-list");
    list.innerHTML = "";
    document.getElementById("lobby-player-count").textContent = `${room.players.length}/8`;
    room.players.forEach(p => {
      const li = document.createElement("li");
      li.className = "player-list-item";
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
    const startBtn   = document.getElementById("btn-start-game");
    const waitingMsg = document.getElementById("lobby-waiting-msg");
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
  const gameScreen = document.getElementById("screen-game");
  if (gameScreen && !gameScreen.classList.contains("hidden")) {
    updateScoreboard(room.players);
  }
});

// ─── Scoreboard ───────────────────────────────────────────────────────────────
function updateScoreboard(players) {
  const list = document.getElementById("game-scoreboard");
  if (!list) return;
  list.innerHTML = "";
  const sorted = [...players].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
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
    clicks.textContent = p.finished ? "🏆" : `${p.clicks}`;
    li.appendChild(rank); li.appendChild(av); li.appendChild(info); li.appendChild(clicks);
    list.appendChild(li);
  });
}

// ─── Game starting ────────────────────────────────────────────────────────────
socket.on("game:starting", (data) => {
  clickCount    = 0;
  myPath        = [];
  gameTarget    = data.target;
  gameTargetUrl = data.targetUrl;
  punished      = false;

  document.getElementById("game-target-name").textContent    = data.target;
  document.getElementById("sidebar-target-name").textContent = data.target;
  document.getElementById("game-click-count").textContent    = "0";
  document.getElementById("path-trail").innerHTML            = "";
  document.getElementById("punishment-banner").classList.add("hidden");
  updateBackButton();

  const overlay  = document.getElementById("overlay-countdown");
  const numEl    = document.getElementById("countdown-number");
  const startEl  = document.getElementById("countdown-start");
  const targetEl = document.getElementById("countdown-target");

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
      myPath = [{ title: data.startArticle, url: data.startUrl }];
      updatePathTrail();
      updateBackButton();
      loadWikipedia(data.startUrl, data.startArticle);
    } else {
      numEl.textContent = count;
      numEl.style.animation = "none";
      void numEl.offsetWidth;
      numEl.style.animation = "";
    }
  }, 1000);
});

// ─── Wikipedia loader — proxied through our server to avoid CORS ──────────────
async function loadWikipedia(url, articleTitle) {
  const loading = document.getElementById("wiki-loading");
  loading.classList.remove("hidden");

  const rawTitle = decodeURIComponent((url.split("/wiki/")[1] || "").split("#")[0]);
  const lang = punished ? "zh" : "en";

  // Use our server-side proxy to fetch Wikipedia content (avoids CORS block)
  const proxyUrl = `/wiki-proxy?title=${encodeURIComponent(rawTitle)}&lang=${lang}`;

  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("proxy fetch failed");
    const html = await res.text();

    const frame = document.getElementById("wiki-frame");

    const injectCSS = `
      <link rel="stylesheet" href="https://${lang}.wikipedia.org/w/load.php?modules=mediawiki.legacy.commonPrint,shared|mediawiki.skinning.elements|mediawiki.skinning.content|mediawiki.skinning.interface|skins.vector.styles|site&only=styles&skin=vector">
      <style>
        body { margin: 0; padding: 16px 24px; font-family: -apple-system, 'Linux Libertine', Georgia, serif; }
        #searchform, .cdx-search-input, .vector-search-box,
        #p-search, .search-toggle, #searchInput, .searchButton { display: none !important; }
        a[href] { color: #3366CC; }
        a[href]:hover { text-decoration: underline; }
        a[href*="Special:"], a[href*="Wikipedia:"], a[href*="Help:"],
        a[href*="Talk:"], a[href*="User:"], a[href*="Category:"],
        a[href*="Portal:"], a[href*="Template:"], a[href*="Draft:"],
        a[href*="File:"], a[href^="//"], a[href^="http"],
        a[href*="#cite_"], a[href*="#ref_"] {
          pointer-events: none; opacity: 0.45; cursor: default;
        }
        .mw-editsection { display: none !important; }
        .catlinks { display: none !important; }
        img { max-width: 100%; height: auto; }
      </style>
    `;

    const base = `<base href="https://${lang}.wikipedia.org/wiki/">`;
    frame.srcdoc = `<!DOCTYPE html><html><head>${base}${injectCSS}</head><body>${html}</body></html>`;

    const displayTitle = articleTitle || rawTitle.replace(/_/g, " ");
    document.getElementById("game-current-article").textContent = displayTitle;
    loading.classList.add("hidden");

    enableLinkTracking(frame);
  } catch (err) {
    loading.classList.add("hidden");
    showToast("Failed to load article — try another link", "error");
    console.error(err);
  }
}

// ─── Link tracking ────────────────────────────────────────────────────────────
function enableLinkTracking(frame) {
  frame.onload = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;

      // ── Search bar punishment detection ──
      // Intercept any form submission (Wikipedia search)
      doc.addEventListener("submit", (e) => {
        const form = e.target;
        if (form && (form.id === "searchform" || form.action?.includes("search") || form.querySelector("#searchInput"))) {
          e.preventDefault();
          triggerPunishment();
        }
      });

      // Also intercept clicks on search button
      doc.addEventListener("click", (e) => {
        const el = e.target;
        // Search button click
        if (el.classList?.contains("searchButton") || el.closest?.("#searchform") ||
            el.closest?.(".cdx-search-input") || el.closest?.(".vector-search-box")) {
          e.preventDefault();
          triggerPunishment();
          return;
        }

        const a = e.target.closest("a");
        if (!a) return;
        const href = a.getAttribute("href");
        if (!href) return;

        // Block non-wiki links
        if (!href.startsWith("/wiki/")) { e.preventDefault(); return; }

        // Block namespace links
        const blocked = ["Special:", "Wikipedia:", "Help:", "Talk:", "User:",
                         "File:", "Category:", "Portal:", "Template:", "Draft:"];
        const articlePart = decodeURIComponent(href.split("/wiki/")[1] || "");
        if (blocked.some(ns => articlePart.startsWith(ns))) { e.preventDefault(); return; }
        if (href.includes("#")) {
          // Allow anchor links on same page (don't navigate)
          const justAnchor = href.startsWith("#") || !href.split("#")[0].replace("/wiki/", "");
          if (justAnchor) { e.preventDefault(); return; }
        }

        e.preventDefault();

        // ── Count this as a click ──
        clickCount++;
        document.getElementById("game-click-count").textContent = clickCount;

        const displayName = articlePart.split("#")[0].replace(/_/g, " ");
        document.getElementById("game-current-article").textContent = displayName;

        // Push to path
        const cleanHref = "/wiki/" + href.split("/wiki/")[1].split("#")[0];
        myPath.push({ title: displayName, url: cleanHref });
        updatePathTrail();
        updateBackButton();

        socket.emit("game:navigate", { article: displayName, url: cleanHref });
        loadWikipedia(cleanHref, displayName);
      });
    } catch (err) {
      console.warn("Link tracking error:", err);
    }
  };
}

// ─── Search punishment: 30s Chinese Wikipedia ────────────────────────────────
function triggerPunishment() {
  if (punished) return; // already punished
  punished = true;

  showToast("⚠️ No searching! Switching to Chinese for 30 seconds!", "error");

  const banner = document.getElementById("punishment-banner");
  const timerEl = document.getElementById("punishment-timer");
  banner.classList.remove("hidden");

  let remaining = 30;
  timerEl.textContent = remaining;

  // Reload current article in Chinese
  const currentUrl = myPath.length ? myPath[myPath.length - 1].url : null;
  if (currentUrl) loadWikipedia(currentUrl, null);

  punishTimer = setInterval(() => {
    remaining--;
    timerEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(punishTimer);
      punished = false;
      banner.classList.add("hidden");
      showToast("Punishment over! Back to English.", "success");
      // Reload in English
      const cur = myPath.length ? myPath[myPath.length - 1] : null;
      if (cur) loadWikipedia(cur.url, cur.title);
    }
  }, 1000);
}

// ─── Back button ─────────────────────────────────────────────────────────────
function goBack() {
  if (myPath.length <= 1) return;

  myPath.pop();
  const prev = myPath[myPath.length - 1];

  // Going back does NOT add a click — it reduces by 1
  clickCount = Math.max(0, clickCount - 1);
  document.getElementById("game-click-count").textContent = clickCount;
  document.getElementById("game-current-article").textContent = prev.title;

  updatePathTrail();
  updateBackButton();

  // Tell server — going back to prev article (server updates currentArticle)
  socket.emit("game:navigate", { article: prev.title, url: prev.url });

  loadWikipedia(prev.url, prev.title);
}

function updateBackButton() {
  const btn = document.getElementById("btn-back");
  if (!btn) return;
  btn.disabled = myPath.length <= 1;
  if (myPath.length <= 1) btn.classList.add("btn-back-disabled");
  else btn.classList.remove("btn-back-disabled");
}

// ─── Path trail ───────────────────────────────────────────────────────────────
function updatePathTrail() {
  const trail = document.getElementById("path-trail");
  if (!trail) return;
  trail.innerHTML = "";
  myPath.forEach((entry, i) => {
    if (i > 0) {
      const arrow = document.createElement("span");
      arrow.className = "trail-arrow";
      arrow.textContent = "›";
      trail.appendChild(arrow);
    }
    const pill = document.createElement("span");
    pill.className = "trail-pill" + (i === myPath.length - 1 ? " trail-current" : "");
    pill.textContent = entry.title;
    trail.appendChild(pill);
  });
  trail.scrollLeft = trail.scrollWidth;
}

// ─── No timer — game is infinite ─────────────────────────────────────────────
// server still sends game:tick but we don't show a timer, just ignore it
socket.on("game:tick", () => {}); // intentionally empty

// ─── Win ──────────────────────────────────────────────────────────────────────
socket.on("game:won", ({ clicks, time, path }) => {
  const s = Math.floor(time / 1000);
  const timeStr = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
  showToast(`🏆 You won in ${clicks} clicks (${timeStr})!`, "success");
});

// ─── Game over — shown to ALL players ────────────────────────────────────────
socket.on("game:over", ({ leaderboard, winner }) => {
  const overlay  = document.getElementById("overlay-gameover");
  const list     = document.getElementById("gameover-leaderboard");
  const title    = document.getElementById("gameover-title");
  const result   = document.getElementById("gameover-your-result");
  const playBtn  = document.getElementById("btn-play-again");
  const pathDiv  = document.getElementById("gameover-winner-path");

  list.innerHTML = "";
  overlay.classList.remove("hidden");

  const me = leaderboard.find(p => p.id === socket.id);
  const iWon = me && me.finished && me.rank === 1;

  result.textContent = iWon ? "🏆" : "😔";
  title.textContent  = iWon ? "You Won!" : `${winner?.name || "Someone"} Won!`;

  // Show winner's path
  if (winner && winner.articlePath && winner.articlePath.length > 0) {
    pathDiv.classList.remove("hidden");
    pathDiv.innerHTML = `<div class="winner-path-label">🏆 ${winner.name}'s winning path (${winner.clicks} clicks):</div>
      <div class="winner-path-pills">${winner.articlePath.map((a, i) =>
        `<span class="winner-pill${i === winner.articlePath.length-1 ? ' winner-pill-last' : ''}">${a}</span>`
      ).join('<span class="winner-arrow">›</span>')}</div>`;
  } else {
    pathDiv.classList.add("hidden");
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
      statsEl.textContent = `${p.clicks} clicks — Did not finish`;
    }

    li.appendChild(rankEl); li.appendChild(nameEl); li.appendChild(statsEl);
    list.appendChild(li);
  });

  if (isHost) playBtn.classList.remove("hidden");
  else        playBtn.classList.add("hidden");
});

socket.on("game:reset", () => {
  document.getElementById("overlay-gameover").classList.add("hidden");
  if (punishTimer) clearInterval(punishTimer);
  punished = false;
  document.getElementById("punishment-banner").classList.add("hidden");
  showScreen("lobby");
});

// ─── Avatar colors ────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#3366CC","#2E7D32","#6A1B9A","#C62828","#AD6800",
  "#00695C","#1565C0","#4527A0","#558B2F","#BF360C"
];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}