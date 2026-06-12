/**
 * SpeedWiki — client.js
 *
 * Wikipedia rendering: uses w/api.php?action=parse&origin=* 
 * (CORS-safe, no proxy needed — same approach as WikipediaRaces.com)
 * Renders into a div with innerHTML — no iframe needed.
 */

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let roomCode      = null;
let isHost        = false;
let playerName    = "";
let clickCount    = 0;
let myPath        = [];
let joining       = false;
let gameTarget    = null;
let gameTargetUrl = null;
let punished      = false;
let punishTimer   = null;
let pageLoading   = false;
let elapsedMs     = 0;
let timerInterval = null;
let lastTickTime  = null;

// Namespace prefixes to block (from WikipediaRaces.com source)
const BLOCKED_PREFIXES = [
  "Wikipedia:", "Help:", "Template:", "Category:", "File:",
  "Special:", "Talk:", "User:", "Portal:", "Draft:", "Module:", "MediaWiki:"
];

// ─── Wikipedia API ────────────────────────────────────────────────────────────
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_API_ZH = "https://zh.wikipedia.org/w/api.php";

async function fetchWikiPage(title, lang = "en") {
  const api = lang === "zh" ? WIKI_API_ZH : WIKI_API;
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    format: "json",
    prop: "text|displaytitle",
    disableeditsection: "true",
    redirects: "true",
    origin: "*",
  });
  const res = await fetch(`${api}?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info || "Wikipedia API error");
  return { title: data.parse.title, html: data.parse.text["*"] };
}

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

  // Only show commit badge on home screen
  const badge = document.getElementById("commit-badge");
  if (badge) {
    if (name === "home") badge.classList.remove("hidden");
    else                 badge.classList.add("hidden");
  }
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

// ─── Latest commit badge (home screen, bottom left) ───────────────────────────
async function fetchLatestCommit() {
  const badge   = document.getElementById("commit-badge");
  const hashEl  = document.getElementById("commit-hash");
  const msgEl   = document.getElementById("commit-msg");
  if (!badge) return;

  try {
    const res = await fetch(
      "https://api.github.com/repos/Ma1nstone/WikiSpeedrun/commits?per_page=1",
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return;
    const [commit] = await res.json();
    if (!commit) return;

    const sha     = commit.sha.slice(0, 7);
    const message = commit.commit.message.split("\n")[0]; // first line only
    const date    = new Date(commit.commit.author.date);
    const ago     = timeAgo(date);

    hashEl.textContent = sha;
    msgEl.textContent  = `${message} · ${ago}`;
    badge.classList.remove("hidden");
    badge.title = `${commit.commit.author.name} — ${date.toLocaleString()}`;
  } catch (e) {
    // GitHub API unavailable — silently hide badge
  }
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60)   return "just now";
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
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
  fetchLatestCommit();

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

  // Wiki content click handler — single delegated listener on the container
  const wikiContent = document.getElementById("wiki-content");
  if (wikiContent) {
    wikiContent.addEventListener("click", handleWikiClick);
  }

  // Back button
  document.getElementById("btn-back").onclick = () => goBack();

  document.getElementById("btn-play-again").onclick = () => socket.emit("game:playAgain");
  document.getElementById("btn-gameover-leave").onclick = () => {
    disableGameGuard();
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
      startBtn.classList.remove("hidden"); waitingMsg.classList.add("hidden"); isHost = true;
    } else {
      startBtn.classList.add("hidden"); waitingMsg.classList.remove("hidden"); isHost = false;
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
    li.className = "score-item" + (p.finished ? " score-finished" : "") + (p.id === socket.id ? " score-you" : "");
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
    info.appendChild(nameEl); info.appendChild(articleEl);
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
      elapsedMs += Date.now() - lastTickTime;
      updateTimerDisplay();
    }
    lastTickTime = Date.now();
  }, 100);
}
function pauseTimer()  { pageLoading = true;  document.getElementById("game-timer")?.classList.add("loading"); }
function resumeTimer() { pageLoading = false; document.getElementById("game-timer")?.classList.remove("loading"); lastTickTime = Date.now(); }
function stopTimer()   { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
function updateTimerDisplay() {
  const s = Math.floor(elapsedMs / 1000);
  const el = document.getElementById("timer-value");
  if (el) el.textContent = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;
}
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
  // Clear scoreboard so previous game scores don't show
  const sb = document.getElementById("game-scoreboard");
  if (sb) sb.innerHTML = "";
  updateBackButton();
  const timerEl = document.getElementById("timer-value");
  if (timerEl) timerEl.textContent = "0:00";

  const overlay  = document.getElementById("overlay-countdown");
  const numEl    = document.getElementById("countdown-number");
  document.getElementById("countdown-start").textContent  = data.startArticle;
  document.getElementById("countdown-target").textContent = data.target;
  overlay.classList.remove("hidden");
  showScreen("game");

  let count = 3;
  numEl.textContent = count;
  const tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(tick);
      overlay.classList.add("hidden");
      const startTitle = data.startUrl.split("/wiki/")[1];
      myPath = [{ title: data.startArticle, url: data.startUrl }];
      updatePathTrail();
      updateBackButton();
      startFairTimer();
      enableGameGuard(); // block browser back + reload while racing
      loadWikiPage(startTitle, data.startArticle);
    } else {
      numEl.textContent = count;
      numEl.style.animation = "none";
      void numEl.offsetWidth;
      numEl.style.animation = "";
    }
  }, 1000);
});

// ─── Load Wikipedia page via API (CORS-safe, no proxy) ───────────────────────
async function loadWikiPage(title, displayTitle) {
  pauseTimer();

  const wikiArea   = document.getElementById("wiki-content");
  const titleEl    = document.getElementById("wiki-page-title");
  const loadingEl  = document.getElementById("wiki-loading");
  const scrollArea = document.getElementById("wiki-scroll-area");

  if (loadingEl)  loadingEl.classList.remove("hidden");
  if (wikiArea)   wikiArea.innerHTML = "";
  if (scrollArea) scrollArea.scrollTop = 0;

  const lang = punished ? "zh" : "en";

  try {
    const { title: resolvedTitle, html } = await fetchWikiPage(title, lang);

    if (titleEl) titleEl.textContent = displayTitle || resolvedTitle;
    if (wikiArea) wikiArea.innerHTML = html;

    document.getElementById("game-current-article").textContent = displayTitle || resolvedTitle;
  } catch (err) {
    if (wikiArea) wikiArea.innerHTML = `<p style="color:#d33;padding:20px">Failed to load article. Try clicking another link.</p>`;
    console.error(err);
  } finally {
    if (loadingEl) loadingEl.classList.add("hidden");
    resumeTimer();
  }
}

// ─── Wiki click handler (delegated on #wiki-content) ─────────────────────────
function handleWikiClick(e) {
  const a = e.target.closest("a");
  if (!a) return;

  e.preventDefault();
  e.stopPropagation();

  const href = a.getAttribute("href");
  if (!href) return;

  // ── Anchor (#section) links — scroll WITHIN wiki-scroll-area ──
  // document.getElementById won't work here because the headings are
  // inside #wiki-content div, not at document root level.
  // We must search inside the wiki-content container directly.
  if (href.startsWith("#")) {
    const sectionId  = href.slice(1);
    const wikiArea   = document.getElementById("wiki-content");
    const scrollArea = document.getElementById("wiki-scroll-area");
    if (!wikiArea || !scrollArea) return;

    // Wikipedia headings have id on the <h2>/<h3> tag or on a <span> inside them
    const target = wikiArea.querySelector(`#${CSS.escape(sectionId)}`) ||
                   wikiArea.querySelector(`[name="${sectionId}"]`) ||
                   wikiArea.querySelector(`span[id="${sectionId}"]`);

    if (target) {
      // Calculate offset relative to the scrollable container
      const containerTop  = scrollArea.getBoundingClientRect().top;
      const targetTop     = target.getBoundingClientRect().top;
      const offset        = targetTop - containerTop + scrollArea.scrollTop - 8;
      scrollArea.scrollTo({ top: offset, behavior: "smooth" });
    }
    return; // no click count, no navigation
  }

  // ── /wiki/ links — navigate to article ──
  const match = href.match(/\/wiki\/([^#?]+)/);
  if (!match) return;

  const rawTitle = decodeURIComponent(match[1]);

  // Block namespace links
  if (BLOCKED_PREFIXES.some(p => rawTitle.startsWith(p))) return;

  // Block red links and edit links
  if (a.classList.contains("new") || href.includes("redlink=1") || href.includes("action=edit")) return;

  // Block external links
  if (a.classList.contains("external") || href.startsWith("http") || href.startsWith("//")) return;

  // Valid article click — count it
  clickCount++;
  document.getElementById("game-click-count").textContent = clickCount;

  const displayName = rawTitle.replace(/_/g, " ");
  const cleanUrl    = "/wiki/" + match[1];

  document.getElementById("game-current-article").textContent = displayName;

  myPath.push({ title: displayName, url: cleanUrl });
  updatePathTrail();
  updateBackButton();

  socket.emit("game:navigate", { article: displayName, url: cleanUrl });
  loadWikiPage(match[1], displayName);
}

// ─── Block browser back button + reload while in-game ────────────────────────
// Prevents accidental navigation away mid-race.
let inGame = false;

function enableGameGuard() {
  inGame = true;
  // Push a dummy history state so the browser back button hits it first
  history.pushState({ gameActive: true }, "");

  window.addEventListener("popstate", handlePopstate);
  window.addEventListener("beforeunload", handleBeforeUnload);
}

function disableGameGuard() {
  inGame = false;
  window.removeEventListener("popstate", handlePopstate);
  window.removeEventListener("beforeunload", handleBeforeUnload);
}

function handlePopstate(e) {
  if (!inGame) return;
  // Re-push state so back button never actually navigates away
  history.pushState({ gameActive: true }, "");
  showToast("Can't go back — you're in a race!", "warning");
}

function handleBeforeUnload(e) {
  if (!inGame) return;
  e.preventDefault();
  e.returnValue = "You're in a race! Are you sure you want to leave?";
  return e.returnValue;
}

// ─── Search punishment ────────────────────────────────────────────────────────
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
  if (cur) loadWikiPage(cur.url.split("/wiki/")[1], cur.title);
  punishTimer = setInterval(() => {
    remaining--;
    timerEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(punishTimer);
      punished = false;
      banner.classList.add("hidden");
      showToast("Punishment over! Back to English.", "success");
      const c = myPath.length ? myPath[myPath.length - 1] : null;
      if (c) loadWikiPage(c.url.split("/wiki/")[1], c.title);
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

// ─── Back button ──────────────────────────────────────────────────────────────
function goBack() {
  if (myPath.length <= 1) return;

  // Remove current page from path
  myPath.pop();

  const prev = myPath[myPath.length - 1];

  // Back is FREE — no click added, no click deducted
  // (going back doesn't help you win, so no penalty needed)

  document.getElementById("game-current-article").textContent = prev.title;
  updatePathTrail();
  updateBackButton();

  // Tell server we're back on previous article (doesn't count as navigate click)
  socket.emit("game:navigate", { article: prev.title, url: prev.url });

  loadWikiPageNoHistory(prev.url.split("/wiki/")[1], prev.title);
}

// Load a page without pushing to myPath (used by goBack)
async function loadWikiPageNoHistory(title, displayTitle) {
  pauseTimer();
  const loadingEl  = document.getElementById("wiki-loading");
  const wikiArea   = document.getElementById("wiki-content");
  const titleEl    = document.getElementById("wiki-page-title");
  const scrollArea = document.getElementById("wiki-scroll-area");

  if (loadingEl)  loadingEl.classList.remove("hidden");
  if (wikiArea)   wikiArea.innerHTML = "";
  if (scrollArea) scrollArea.scrollTop = 0;

  const lang = punished ? "zh" : "en";
  try {
    const { title: resolvedTitle, html } = await fetchWikiPage(title, lang);
    if (titleEl)  titleEl.textContent  = displayTitle || resolvedTitle;
    if (wikiArea) wikiArea.innerHTML   = html;
    document.getElementById("game-current-article").textContent = displayTitle || resolvedTitle;
  } catch (err) {
    if (wikiArea) wikiArea.innerHTML = `<p style="color:#d33;padding:20px">Failed to load article.</p>`;
  } finally {
    if (loadingEl) loadingEl.classList.add("hidden");
    resumeTimer();
  }
}

function updateBackButton() {
  const btn = document.getElementById("btn-back");
  if (!btn) return;
  btn.disabled = myPath.length <= 1;
}

// ─── Win ──────────────────────────────────────────────────────────────────────
socket.on("game:won", ({ clicks, time }) => {
  stopTimer();
  disableGameGuard(); // game finished — allow reload/back again
  const s = Math.floor(time / 1000);
  showToast(`🏆 You won in ${clicks} clicks (${Math.floor(s/60)}:${(s%60).toString().padStart(2,"00")})!`, "success");
});

// ─── Game over ────────────────────────────────────────────────────────────────
socket.on("game:over", ({ leaderboard, winner }) => {
  stopTimer();
  disableGameGuard(); // game finished — allow reload/back again
  const overlay = document.getElementById("overlay-gameover");
  const list    = document.getElementById("gameover-leaderboard");
  const title   = document.getElementById("gameover-title");
  const result  = document.getElementById("gameover-your-result");
  const playBtn = document.getElementById("btn-play-again");
  const pathDiv = document.getElementById("gameover-winner-path");

  list.innerHTML = "";
  overlay.classList.remove("hidden");

  const me   = leaderboard.find(p => p.id === socket.id);
  const iWon = me && me.finished && me.rank === 1;
  result.textContent = iWon ? "🏆" : "😔";
  title.textContent  = iWon ? "You Won!" : `${winner?.name || "Someone"} Won!`;

  if (winner?.articlePath?.length > 0) {
    pathDiv.classList.remove("hidden");
    pathDiv.innerHTML = `
      <div class="winner-path-label">🏆 ${winner.name}'s winning path (${winner.clicks} clicks):</div>
      <div class="winner-path-pills">
        ${winner.articlePath.map((a, i) =>
          `<span class="winner-pill${i === winner.articlePath.length-1 ? ' winner-pill-last' : ''}">${a}</span>` +
          (i < winner.articlePath.length-1 ? '<span class="winner-arrow">›</span>' : '')
        ).join('')}
      </div>`;
  } else {
    pathDiv.classList.add("hidden");
  }

  const rankEmojis = ["🥇","🥈","🥉"];
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
      const s = Math.floor(p.finishTime/1000);
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
  stopTimer();
  disableGameGuard();
  document.getElementById("overlay-gameover").classList.add("hidden");
  if (punishTimer) clearInterval(punishTimer);
  punished = false;
  document.getElementById("punishment-banner").classList.add("hidden");
  const sb = document.getElementById("game-scoreboard");
  if (sb) sb.innerHTML = "";
  showScreen("lobby");
});

// ─── Avatar colors ────────────────────────────────────────────────────────────
const AVATAR_COLORS = ["#3366CC","#2E7D32","#6A1B9A","#C62828","#AD6800","#00695C","#1565C0","#4527A0","#558B2F","#BF360C"];
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}