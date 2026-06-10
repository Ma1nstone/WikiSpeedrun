/**
 * SpeedWiki — client.js
 *
 * Rules (per official WikiRace / The Wiki Game standard):
 *  - Navigation only through body text links (main content area only)
 *  - No search bar (30s Chinese punishment)
 *  - No back button (forces creative paths — standard rule)
 *  - No sidebar, navbox, infobox, category, or footer links
 *  - Timer pauses during page loads (fair competition)
 *  - First player to reach target wins — game ends for everyone
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let roomCode      = null;
let isHost        = false;
let playerName    = "";
let clickCount    = 0;
let myPath        = [];       // [{ title, url }, ...]
let joining       = false;
let gameTarget    = null;
let gameTargetUrl = null;
let punished      = false;
let punishTimer   = null;
let pageLoading   = false;    // true while article is fetching (timer pauses)
let elapsedMs     = 0;        // fair elapsed time (excludes load time)
let timerInterval = null;
let lastTickTime  = null;

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

// ─── Challenge preview ────────────────────────────────────────────────────────
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

// ─── Fair timer (pauses during page loads) ───────────────────────────────────
function startFairTimer() {
  elapsedMs    = 0;
  lastTickTime = Date.now();
  pageLoading  = false;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!pageLoading) {
      const now = Date.now();
      elapsedMs += now - lastTickTime;
      updateTimerDisplay();
    }
    lastTickTime = Date.now();
  }, 100);
}

function pauseTimer()  { pageLoading = true;  showLoadingIndicator(true);  }
function resumeTimer() { pageLoading = false; showLoadingIndicator(false); lastTickTime = Date.now(); }

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimerDisplay() {
  const totalSec = Math.floor(elapsedMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const el = document.getElementById("timer-value");
  if (el) el.textContent = `${min}:${sec.toString().padStart(2, "0")}`;
}

function showLoadingIndicator(loading) {
  const el = document.getElementById("game-timer");
  if (!el) return;
  if (loading) el.classList.add("loading");
  else         el.classList.remove("loading");
}

// Ignore server ticks — we use our own fair client timer
socket.on("game:tick", () => {});

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
  const timerEl = document.getElementById("timer-value");
  if (timerEl) timerEl.textContent = "0:00";

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
      startFairTimer();
      loadWikipedia(data.startUrl, data.startArticle);
    } else {
      numEl.textContent = count;
      numEl.style.animation = "none";
      void numEl.offsetWidth;
      numEl.style.animation = "";
    }
  }, 1000);
});

// ─── Wikipedia loader (server-proxied, fair timer, CORS-safe) ─────────────────
async function loadWikipedia(url, articleTitle) {
  pauseTimer(); // pause fair timer during load

  const loading = document.getElementById("wiki-loading");
  loading.classList.remove("hidden");

  const rawTitle = decodeURIComponent((url.split("/wiki/")[1] || "").split("#")[0]);
  const lang = punished ? "zh" : "en";
  const proxyUrl = `/wiki-proxy?title=${encodeURIComponent(rawTitle)}&lang=${lang}`;

  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("proxy failed");
    const html = await res.text();

    const frame = document.getElementById("wiki-frame");

    // CSS injected into the iframe:
    // - Loads real Wikipedia stylesheet
    // - Hides ONLY chrome (search, nav, footer, edit links, categories)
    // - Dims non-body links (sidebars, navboxes, infoboxes) — body links stay full colour
    // - Highlights valid clickable body links
    const injectCSS = `
      <link rel="stylesheet" href="https://${lang}.wikipedia.org/w/load.php?modules=mediawiki.skinning.content.parsoid|mediawiki.skinning.interface|skins.vector.styles|ext.cite.styles&only=styles&skin=vector">
      <style>
        html, body { margin: 0; padding: 0; background: #fff; }
        body { padding: 16px 28px 40px; font-family: -apple-system, 'Linux Libertine', Georgia, serif; font-size: 14px; color: #202122; line-height: 1.65; }

        /* ── Hide all Wikipedia chrome ── */
        #mw-navigation, #mw-head, #mw-head-base, #mw-panel,
        #footer, #footer-icons, #footer-info, #footer-places,
        .mw-portlet, .vector-header, .vector-page-toolbar,
        .vector-column-start, .vector-sidebar,
        .mw-table-of-contents-container, #toc, .toc,
        #p-search, .cdx-search-input, .vector-search-box, #searchform,
        #searchInput, .searchButton, .search-toggle,
        .mw-editsection, #ca-edit, #ca-ve-edit, .editlink,
        .catlinks, .sistersitebox, .mw-jump-link,
        .mw-indicators, #siteSub, #contentSub,
        #coordinates, .geo-nondefault, .geo-multi-punct,
        .noprint, .printfooter, #p-lang-btn,
        .mw-portlet-lang, #interwiki-links,
        #p-tb, #p-coll-print_export, #p-wikibase-otherprojects,
        .wb-langlinks-link, .interlanguage-link,
        .refbegin, .reflist        { display: none !important; }

        /* ── Navboxes, infoboxes, sidebars: dim links inside them ── */
        .navbox a, .navbox-inner a,
        .infobox a, .infobox_v3 a,
        .sidebar a, .vertical-navbox a,
        .hatnote a, .hatnote,
        table.wikitable a,
        .mw-content-ltr > table a { opacity: 0.45; pointer-events: none; cursor: default; }

        /* ── Category links at bottom: blocked ── */
        .mw-normal-catlinks a,
        .mw-hidden-catlinks a     { pointer-events: none; opacity: 0.3; cursor: default; }

        /* ── External links: blocked ── */
        a[href^="http"], a[href^="//"],
        a[href*="action=edit"],
        a[href*="redlink=1"]      { pointer-events: none; opacity: 0.35; cursor: default; text-decoration: none; }

        /* ── Namespace links: blocked ── */
        a[href*="Special:"], a[href*="Wikipedia:"], a[href*="Help:"],
        a[href*="Talk:"], a[href*="User:"], a[href*="File:"],
        a[href*="Category:"], a[href*="Portal:"],
        a[href*="Template:"], a[href*="Draft:"],
        a[href*="#cite_"], a[href*="#ref_"]
                                  { pointer-events: none; opacity: 0.35; cursor: default; }

        /* ── Valid body article links: full Wikipedia blue ── */
        #mw-content-text a[href^="/wiki/"]:not([href*=":"]):not([href*="redlink"]) {
          color: #3366CC;
          text-decoration: none;
          cursor: pointer;
        }
        #mw-content-text a[href^="/wiki/"]:not([href*=":"]):not([href*="redlink"]):hover {
          text-decoration: underline;
          color: #0645ad;
        }

        /* ── Images ── */
        img { max-width: 100%; height: auto; }
        figure, .thumb { margin: 0 0 12px 0; }
        .thumbinner { border: 1px solid #EAECF0; background: #f8f9fa; padding: 4px; }

        /* ── Typography ── */
        h1 { font-size: 1.95rem; font-weight: normal; border-bottom: 1px solid #EAECF0; padding-bottom: 4px; margin-bottom: 12px; font-family: 'Linux Libertine', Georgia, serif; }
        h2 { font-size: 1.5rem; font-weight: normal; border-bottom: 1px solid #EAECF0; margin-top: 20px; }
        h3 { font-size: 1.17rem; margin-top: 16px; }
        p  { margin-bottom: 10px; }
        sup { font-size: .75em; }
        .infobox, .infobox_v3 { float: right; margin: 0 0 16px 20px; max-width: 280px; font-size: .85em; border: 1px solid #EAECF0; }
        table.wikitable { border-collapse: collapse; margin: 12px 0; font-size: .9em; }
        table.wikitable th, table.wikitable td { border: 1px solid #EAECF0; padding: 5px 8px; }
        table.wikitable th { background: #eaecf0; }
        blockquote { border-left: 3px solid #EAECF0; margin-left: 0; padding-left: 12px; color: #54595D; }
      </style>
    `;

    const base = `<base href="https://${lang}.wikipedia.org/wiki/">`;
    frame.srcdoc = `<!DOCTYPE html><html><head>${base}${injectCSS}</head><body>${html}</body></html>`;

    const displayTitle = articleTitle || rawTitle.replace(/_/g, " ");
    document.getElementById("game-current-article").textContent = displayTitle;

    enableLinkTracking(frame);
    // resumeTimer() called inside frame.onload via enableLinkTracking
  } catch (err) {
    resumeTimer();
    loading.classList.add("hidden");
    showToast("Failed to load article — try another link", "error");
    console.error(err);
  }
}

// ─── Link tracking (body-text links only) ────────────────────────────────────
function enableLinkTracking(frame) {
  frame.onload = () => {
    resumeTimer(); // page loaded — resume fair timer
    document.getElementById("wiki-loading").classList.add("hidden");

    try {
      const doc = frame.contentDocument || frame.contentWindow.document;

      // ── Search punishment ──
      doc.addEventListener("submit", (e) => {
        if (e.target?.id === "searchform" || e.target?.action?.includes("search")) {
          e.preventDefault();
          triggerPunishment();
        }
      });

      doc.addEventListener("click", (e) => {
        // Search button click = punishment
        if (e.target.closest?.("#searchform") ||
            e.target.closest?.(".cdx-search-input") ||
            e.target.closest?.(".vector-search-box") ||
            e.target.classList?.contains("searchButton")) {
          e.preventDefault();
          triggerPunishment();
          return;
        }

        const a = e.target.closest("a");
        if (!a) return;

        const href = a.getAttribute("href");
        if (!href || !href.startsWith("/wiki/")) { e.preventDefault(); return; }

        // ── Must be inside main content text (body links only) ──
        const contentArea = doc.getElementById("mw-content-text") ||
                            doc.querySelector(".mw-parser-output") ||
                            doc.querySelector("#bodyContent");

        if (contentArea && !contentArea.contains(a)) {
          e.preventDefault();
          showToast("Only body text links allowed!", "warning");
          return;
        }

        // Block namespace links
        const blocked = ["Special:", "Wikipedia:", "Help:", "Talk:", "User:",
                         "File:", "Category:", "Portal:", "Template:", "Draft:"];
        const articlePart = decodeURIComponent((href.split("/wiki/")[1] || "").split("#")[0]);
        if (!articlePart || blocked.some(ns => articlePart.startsWith(ns))) {
          e.preventDefault(); return;
        }

        // Block red links (non-existent articles)
        if (href.includes("redlink=1") || href.includes("action=edit")) {
          e.preventDefault(); return;
        }

        // Block navbox / infobox / table links
        const blockedContainers = [
          ".navbox", ".navbox-inner", ".infobox", ".infobox_v3",
          ".sidebar", ".vertical-navbox", ".hatnote",
          ".mw-normal-catlinks", ".mw-hidden-catlinks",
          "table.wikitable", ".reflist", ".refbegin",
        ];
        if (blockedContainers.some(sel => a.closest(sel))) {
          e.preventDefault();
          showToast("Only body text links — not tables or navboxes!", "warning");
          return;
        }

        e.preventDefault();

        // ── Valid click ──
        clickCount++;
        document.getElementById("game-click-count").textContent = clickCount;

        const displayName = articlePart.replace(/_/g, " ");
        document.getElementById("game-current-article").textContent = displayName;

        const cleanHref = "/wiki/" + articlePart;
        myPath.push({ title: displayName, url: cleanHref });
        updatePathTrail();

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
  if (punished) return;
  punished = true;

  showToast("⚠️ No searching! 30 seconds of Chinese Wikipedia!", "error");

  const banner  = document.getElementById("punishment-banner");
  const timerEl = document.getElementById("punishment-timer");
  banner.classList.remove("hidden");

  let remaining = 30;
  timerEl.textContent = remaining;

  const cur = myPath.length ? myPath[myPath.length - 1] : null;
  if (cur) loadWikipedia(cur.url, cur.title);

  punishTimer = setInterval(() => {
    remaining--;
    timerEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(punishTimer);
      punished = false;
      banner.classList.add("hidden");
      showToast("Punishment over! Back to English.", "success");
      const c = myPath.length ? myPath[myPath.length - 1] : null;
      if (c) loadWikipedia(c.url, c.title);
    }
  }, 1000);
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

// ─── Win ──────────────────────────────────────────────────────────────────────
socket.on("game:won", ({ clicks, time }) => {
  stopTimer();
  const s = Math.floor(time / 1000);
  const timeStr = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
  showToast(`🏆 You won in ${clicks} clicks (${timeStr})!`, "success");
});

// ─── Game over ────────────────────────────────────────────────────────────────
socket.on("game:over", ({ leaderboard, winner }) => {
  stopTimer();

  const overlay = document.getElementById("overlay-gameover");
  const list    = document.getElementById("gameover-leaderboard");
  const title   = document.getElementById("gameover-title");
  const result  = document.getElementById("gameover-your-result");
  const playBtn = document.getElementById("btn-play-again");
  const pathDiv = document.getElementById("gameover-winner-path");

  list.innerHTML = "";
  overlay.classList.remove("hidden");

  const me    = leaderboard.find(p => p.id === socket.id);
  const iWon  = me && me.finished && me.rank === 1;

  result.textContent = iWon ? "🏆" : "😔";
  title.textContent  = iWon ? "You Won!" : `${winner?.name || "Someone"} Won!`;

  // Show winner's path
  if (winner && winner.articlePath?.length > 0) {
    pathDiv.classList.remove("hidden");
    pathDiv.innerHTML = `
      <div class="winner-path-label">🏆 ${winner.name}'s winning path (${winner.clicks} clicks):</div>
      <div class="winner-path-pills">
        ${winner.articlePath.map((a, i) =>
          `<span class="winner-pill${i === winner.articlePath.length - 1 ? ' winner-pill-last' : ''}">${a}</span>` +
          (i < winner.articlePath.length - 1 ? '<span class="winner-arrow">›</span>' : '')
        ).join('')}
      </div>`;
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
    statsEl.textContent = p.finished
      ? (() => { const s = Math.floor(p.finishTime/1000); return `${p.clicks} clicks · ${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`; })()
      : `${p.clicks} clicks — Did not finish`;

    li.appendChild(rankEl); li.appendChild(nameEl); li.appendChild(statsEl);
    list.appendChild(li);
  });

  if (isHost) playBtn.classList.remove("hidden");
  else        playBtn.classList.add("hidden");
});

socket.on("game:reset", () => {
  stopTimer();
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