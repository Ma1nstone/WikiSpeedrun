/**
 * WikiRace — client.js
 * New features:
 *  - Back button: go back through article history infinitely
 *  - Wikipedia rendered inside site via REST API (no search bar, clean view)
 *  - First to finish wins logic
 *  - RACE_CHALLENGES fetched from /api/challenges and shown on home screen
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let roomCode    = null;
let isHost      = false;
let playerName  = "";
let clickCount  = 0;
let myPath      = [];       // array of { title, url } for back navigation
let joining     = false;
let gameTarget  = null;     // target article name for current game
let gameTargetUrl = null;

// ─── Online count ─────────────────────────────────────────────────────────────
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

// ─── Fetch and display challenge list on home screen ─────────────────────────
async function loadChallengePreview() {
  try {
    const res = await fetch('/api/challenges');
    const challenges = await res.json();
    // Pick a random one to show as preview
    const c = challenges[Math.floor(Math.random() * challenges.length)];
    const startEl  = document.getElementById("preview-start");
    const targetEl = document.getElementById("preview-target-name");
    if (startEl)  startEl.textContent  = c.start;
    if (targetEl) targetEl.textContent = c.target;
  } catch (e) {
    // silently fail — preview is decorative
  }
}

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

  loadChallengePreview();

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

  // Modal confirm
  document.getElementById("btn-modal-confirm").onclick = confirmModal;
  document.getElementById("input-name").addEventListener("keydown", e => {
    if (e.key === "Enter") confirmModal();
  });
  const codeInput = document.getElementById("input-room-code");
  if (codeInput) {
    codeInput.addEventListener("keydown", e => { if (e.key === "Enter") confirmModal(); });
    codeInput.addEventListener("input", () => { codeInput.value = codeInput.value.toUpperCase(); });
  }

  // Copy room code
  document.getElementById("btn-copy-code").onclick = () => {
    const code = document.getElementById("lobby-code-value").textContent;
    navigator.clipboard.writeText(code).then(() => showToast("Room code copied!", "success"));
  };

  // Start game
  document.getElementById("btn-start-game").onclick = () => socket.emit("game:start");

  // Leave lobby
  document.getElementById("btn-leave-lobby").onclick = () => {
    socket.emit("lobby:leave");
    showScreen("home");
    roomCode = null; isHost = false;
  };

  // Back button
  document.getElementById("btn-back").onclick = () => goBack();

  // Play Again
  document.getElementById("btn-play-again").onclick = () => socket.emit("game:playAgain");

  // Game over Leave
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

// ─── Game starting ────────────────────────────────────────────────────────────
socket.on("game:starting", (data) => {
  clickCount   = 0;
  myPath       = [];
  gameTarget   = data.target;
  gameTargetUrl = data.targetUrl;

  document.getElementById("game-target-name").textContent = data.target;
  document.getElementById("game-click-count").textContent = "0";
  document.getElementById("path-trail").innerHTML = "";
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
      // Load start article — push to history
      myPath = [{ title: data.startArticle, url: data.startUrl }];
      updatePathTrail();
      updateBackButton();
      loadWikipedia(data.startUrl, data.startArticle, false);
    } else {
      numEl.textContent = count;
      numEl.style.animation = "none";
      void numEl.offsetWidth;
      numEl.style.animation = "";
    }
  }, 1000);
});

// ─── Wikipedia loader ─────────────────────────────────────────────────────────
async function loadWikipedia(url, articleTitle, countAsClick = true) {
  const loading = document.getElementById("wiki-loading");
  loading.classList.remove("hidden");

  const rawTitle = url.split("/wiki/")[1];

  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${rawTitle}`);
    if (!res.ok) throw new Error("Fetch failed");
    const html = await res.text();

    const frame = document.getElementById("wiki-frame");

    const injectCSS = `
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, 'Linux Libertine', Georgia, serif;
          padding: 24px 32px;
          max-width: 980px;
          margin: 0 auto;
          color: #202122;
          line-height: 1.6;
        }
        /* Hide all Wikipedia chrome — search bar, nav, footer, edit links */
        .mw-header, .mw-navigation, #mw-head, #mw-head-base,
        #mw-panel, #footer, #footer-icons, #footer-info,
        .navbox, .navbox-styles, .noprint, .mw-portlet,
        #siteSub, #contentSub, .mw-indicators, .catlinks,
        .mw-editsection, #coordinates, .sistersitebox,
        .mw-jump-link, .searchButton, #searchInput,
        #p-search, .vector-search-box, .cdx-search-input,
        .mw-wiki-logo, #p-logo, .mw-body-header,
        .page-actions, .mw-portlet-lang, #p-lang-btn,
        .vector-page-toolbar, .mw-table-of-contents-container,
        .toc, #toc, .tocnumber, .mw-content-ltr > .toc,
        #p-tb, #p-coll-print_export, #p-wikibase-otherprojects,
        .wb-langlinks-link, .interlanguage-link { display: none !important; }

        /* Style valid wiki links */
        a[href^="/wiki/"] {
          color: #3366CC;
          text-decoration: none;
          cursor: pointer;
        }
        a[href^="/wiki/"]:hover { text-decoration: underline; }

        /* Dim/disable non-article links */
        a[href^="http"], a[href^="//"],
        a[href*="#cite_"], a[href*="#ref_"],
        a[href*="Special:"], a[href*="Wikipedia:"],
        a[href*="Help:"], a[href*="Talk:"], a[href*="User:"],
        a[href*="File:"], a[href*="Category:"],
        a[href*="Portal:"], a[href*="Template:"], a[href*="Draft:"] {
          pointer-events: none;
          opacity: 0.4;
          cursor: default;
          text-decoration: none;
        }

        img { max-width: 100%; height: auto; }
        figure { margin: 0 0 16px 0; }

        .infobox, .infobox_v3 {
          float: right;
          margin: 0 0 16px 24px;
          max-width: 300px;
          font-size: .85em;
          border: 1px solid #EAECF0;
          border-radius: 6px;
          padding: 10px;
          background: #f8f9fa;
        }
        h1 {
          font-size: 1.9rem;
          border-bottom: 1px solid #EAECF0;
          padding-bottom: 8px;
          margin-bottom: 16px;
          font-weight: 600;
        }
        h2 { font-size: 1.4rem; border-bottom: 1px solid #EAECF0; margin-top: 24px; }
        h3 { font-size: 1.1rem; margin-top: 16px; }
        p  { margin-bottom: 12px; }
        table.wikitable {
          border-collapse: collapse;
          margin: 16px 0;
          font-size: .9em;
          width: 100%;
        }
        table.wikitable th, table.wikitable td {
          border: 1px solid #EAECF0;
          padding: 6px 10px;
        }
        table.wikitable th { background: #f0f3f9; }
        blockquote { border-left: 3px solid #EAECF0; padding-left: 12px; color: #54595D; }
        sup { font-size: .7em; }
      </style>
    `;

    frame.srcdoc = `<base href="https://en.wikipedia.org/wiki/">${injectCSS}${html}`;

    const displayTitle = articleTitle || decodeURIComponent(rawTitle.replace(/_/g, " "));
    document.getElementById("game-current-article").textContent = displayTitle;
    loading.classList.add("hidden");

    enableLinkTracking(frame, countAsClick);
  } catch (err) {
    loading.classList.add("hidden");
    showToast("Failed to load article — try a different link", "error");
  }
}

// ─── Link tracking ────────────────────────────────────────────────────────────
function enableLinkTracking(frame) {
  frame.onload = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      doc.addEventListener("click", (e) => {
        const a = e.target.closest("a");
        if (!a) return;

        const href = a.getAttribute("href");
        if (!href) return;

        if (!href.startsWith("/wiki/")) { e.preventDefault(); return; }

        const blocked = ["Special:", "Wikipedia:", "Help:", "Talk:", "User:",
                         "File:", "Category:", "Portal:", "Template:", "Draft:"];
        const articlePart = decodeURIComponent(href.split("/wiki/")[1] || "");
        if (blocked.some(ns => articlePart.startsWith(ns))) { e.preventDefault(); return; }

        // Ignore anchor-only links (same page)
        if (href.startsWith("#")) { e.preventDefault(); return; }

        e.preventDefault();

        clickCount++;
        document.getElementById("game-click-count").textContent = clickCount;

        const displayName = articlePart.replace(/_/g, " ");
        document.getElementById("game-current-article").textContent = displayName;

        // Push to path history
        myPath.push({ title: displayName, url: href });
        updatePathTrail();
        updateBackButton();

        socket.emit("game:navigate", { article: displayName, url: href });

        loadWikipedia(href, displayName, true);
      });
    } catch (err) {
      console.warn("Link tracking error:", err);
    }
  };
}

// ─── Back button ─────────────────────────────────────────────────────────────
function goBack() {
  if (myPath.length <= 1) return; // can't go back from the start

  // Remove current page
  myPath.pop();

  const prev = myPath[myPath.length - 1];

  // Undo the click count
  clickCount = Math.max(0, clickCount - 1);
  document.getElementById("game-click-count").textContent = clickCount;

  document.getElementById("game-current-article").textContent = prev.title;

  updatePathTrail();
  updateBackButton();

  // Tell server we went back (navigate to previous article)
  socket.emit("game:navigate", { article: prev.title, url: prev.url });

  // Load without adding to path (already managed above)
  loadWikiBack(prev.url, prev.title);
}

// Load without pushing to myPath (used by back button)
async function loadWikiBack(url, articleTitle) {
  const loading = document.getElementById("wiki-loading");
  loading.classList.remove("hidden");
  const rawTitle = url.split("/wiki/")[1];
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${rawTitle}`);
    if (!res.ok) throw new Error("Fetch failed");
    const html = await res.text();
    const frame = document.getElementById("wiki-frame");
    const injectCSS = getInjectCSS();
    frame.srcdoc = `<base href="https://en.wikipedia.org/wiki/">${injectCSS}${html}`;
    loading.classList.add("hidden");
    enableLinkTracking(frame);
  } catch (err) {
    loading.classList.add("hidden");
    showToast("Failed to load article", "error");
  }
}

function getInjectCSS() {
  return `<style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system,'Linux Libertine',Georgia,serif; padding: 24px 32px; max-width: 980px; margin: 0 auto; color: #202122; line-height: 1.6; }
    .mw-header,.mw-navigation,#mw-head,#mw-head-base,#mw-panel,#footer,#footer-icons,#footer-info,.navbox,.navbox-styles,.noprint,.mw-portlet,#siteSub,#contentSub,.mw-indicators,.catlinks,.mw-editsection,#coordinates,.sistersitebox,.mw-jump-link,.searchButton,#searchInput,#p-search,.vector-search-box,.cdx-search-input,.mw-wiki-logo,#p-logo,.mw-body-header,.page-actions,.mw-portlet-lang,#p-lang-btn,.vector-page-toolbar,.mw-table-of-contents-container,.toc,#toc,.tocnumber,.mw-content-ltr>.toc,#p-tb,#p-coll-print_export,#p-wikibase-otherprojects,.wb-langlinks-link,.interlanguage-link { display:none!important; }
    a[href^="/wiki/"] { color:#3366CC; text-decoration:none; cursor:pointer; }
    a[href^="/wiki/"]:hover { text-decoration:underline; }
    a[href^="http"],a[href^="//"],a[href*="#cite_"],a[href*="#ref_"],a[href*="Special:"],a[href*="Wikipedia:"],a[href*="Help:"],a[href*="Talk:"],a[href*="User:"],a[href*="File:"],a[href*="Category:"],a[href*="Portal:"],a[href*="Template:"],a[href*="Draft:"] { pointer-events:none; opacity:0.4; cursor:default; text-decoration:none; }
    img { max-width:100%; height:auto; }
    .infobox,.infobox_v3 { float:right; margin:0 0 16px 24px; max-width:300px; font-size:.85em; border:1px solid #EAECF0; border-radius:6px; padding:10px; background:#f8f9fa; }
    h1 { font-size:1.9rem; border-bottom:1px solid #EAECF0; padding-bottom:8px; margin-bottom:16px; font-weight:600; }
    h2 { font-size:1.4rem; border-bottom:1px solid #EAECF0; margin-top:24px; }
    h3 { font-size:1.1rem; margin-top:16px; }
    p { margin-bottom:12px; }
    table.wikitable { border-collapse:collapse; margin:16px 0; font-size:.9em; width:100%; }
    table.wikitable th,table.wikitable td { border:1px solid #EAECF0; padding:6px 10px; }
    table.wikitable th { background:#f0f3f9; }
    sup { font-size:.7em; }
  </style>`;
}

function updateBackButton() {
  const btn = document.getElementById("btn-back");
  if (!btn) return;
  // Disabled if on the very first page (can't go back further)
  if (myPath.length <= 1) {
    btn.disabled = true;
    btn.classList.add("btn-back-disabled");
  } else {
    btn.disabled = false;
    btn.classList.remove("btn-back-disabled");
  }
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

// ─── Timer ────────────────────────────────────────────────────────────────────
socket.on("game:tick", ({ remaining }) => {
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  const el  = document.getElementById("timer-value");
  if (el) el.textContent = `${min}:${sec.toString().padStart(2, "0")}`;
  const timerBox = document.getElementById("game-timer");
  if (timerBox) {
    if (remaining <= 60) timerBox.classList.add("urgent");
    else                 timerBox.classList.remove("urgent");
  }
});

// ─── Win ──────────────────────────────────────────────────────────────────────
socket.on("game:won", ({ rank, clicks, time }) => {
  const s = Math.floor(time / 1000);
  const timeStr = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
  showToast(`🏆 You won in ${clicks} clicks (${timeStr})!`, "success");
});

// ─── Game over ────────────────────────────────────────────────────────────────
socket.on("game:over", ({ leaderboard }) => {
  const overlay = document.getElementById("overlay-gameover");
  const list    = document.getElementById("gameover-leaderboard");
  const title   = document.getElementById("gameover-title");
  const result  = document.getElementById("gameover-your-result");
  const playBtn = document.getElementById("btn-play-again");

  list.innerHTML = "";
  overlay.classList.remove("hidden");

  const me = leaderboard.find(p => p.id === socket.id);
  if (me && me.finished) {
    result.textContent = me.rank === 1 ? "🏆" : "🎉";
    title.textContent  = me.rank === 1 ? "You Won!" : "Race Over!";
  } else {
    result.textContent = "⏱️";
    title.textContent  = "Race Over!";
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

  if (isHost) playBtn.classList.remove("hidden");
  else        playBtn.classList.add("hidden");
});

socket.on("game:reset", () => {
  document.getElementById("overlay-gameover").classList.add("hidden");
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