const socket = io();

socket.on("server:online", ({ count }) => {
  const el = document.getElementById("players");
  if (el) {
    el.textContent = `${count} players online`;
  }
});

let roomCode = null;
let isHost = false;
let playerName = "";
let clickCount = 0;
let currentArticle = "";

let joining = false;
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

function openNameModal(isJoin) {
  joining = isJoin;
  document.getElementById("modal-name").classList.remove("hidden");
}
// WAIT UNTIL HTML EXISTS
window.addEventListener("DOMContentLoaded", () => {

  // ─────────────────────────────
  // MODAL HANDLING
  // ─────────────────────────────

  document.getElementById("btn-create").onclick = () => {
    openNameModal(false);
  };

  document.getElementById("btn-join-open").onclick = () => {
    openNameModal(true);
  };

  document.getElementById("btn-how-to-play").onclick = () => {
    document.getElementById("modal-how").classList.remove("hidden");
  };

  document.getElementById("btn-how-close").onclick = () => {
    document.getElementById("modal-how").classList.add("hidden");
  };

  document.getElementById("btn-modal-cancel").onclick = () => {
    document.getElementById("modal-name").classList.add("hidden");
  };

  document.getElementById("btn-modal-confirm").onclick = () => {
    playerName = document.getElementById("input-name").value.trim();

    if (!playerName) return alert("Enter a name");

    document.getElementById("modal-name").classList.add("hidden");

    if (joining) {
      const code = document.getElementById("input-room-code").value.trim();
      joinLobby(code);
    } else {
      createLobby();
    }
  };

});

// ─────────────────────────────────────────────
// LOBBY SYSTEM
// ─────────────────────────────────────────────
function createLobby() {
  socket.emit("lobby:create", { playerName });
}

function joinLobby(code) {
  socket.emit("lobby:join", {
    roomCode: code,
    playerName
  });
}

socket.on("lobby:created", (data) => {
  roomCode = data.code;
  isHost = true;

  document.getElementById("lobby-code-value").textContent = roomCode;

  showScreen("lobby");
});

socket.on("lobby:joined", (data) => {
  roomCode = data.code;
  isHost = false;

  document.getElementById("lobby-code-value").textContent = roomCode;

  showScreen("lobby");
});

// ─────────────────────────────────────────────
// ROOM STATE UPDATE (players, host, etc)
// ─────────────────────────────────────────────
socket.on("room:state", (room) => {
  const list = document.getElementById("lobby-player-list");
  list.innerHTML = "";

  document.getElementById("lobby-player-count").textContent =
    `${room.players.length}/8`;

  room.players.forEach(p => {
    const li = document.createElement("li");
    li.className = "player-item";

    li.textContent = p.name + (p.id === room.host ? " 👑" : "");
    list.appendChild(li);
  });

  // host controls
  const startBtn = document.getElementById("btn-start-game");
  const waitingMsg = document.getElementById("lobby-waiting-msg");

  if (socket.id === room.host) {
    startBtn.classList.remove("hidden");
    waitingMsg.classList.add("hidden");
  } else {
    startBtn.classList.add("hidden");
    waitingMsg.classList.remove("hidden");
  }
});

// ─────────────────────────────────────────────
// START GAME
// ─────────────────────────────────────────────
document.getElementById("btn-start-game").onclick = () => {
  socket.emit("game:start");
};

socket.on("game:starting", (data) => {
  showScreen("game");

  clickCount = 0;
  updateClicks();

  document.getElementById("game-target-name").textContent = data.target;

  loadWikipedia(data.startUrl);
});

// ─────────────────────────────────────────────
// WIKIPEDIA SYSTEM (API MODE)
// ─────────────────────────────────────────────

// Load article using Wikipedia API
async function loadWikipedia(url) {
  document.getElementById("wiki-loading").style.display = "flex";

  const title = url.split("/wiki/")[1];

  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/html/${title}`
  );

  const html = await res.text();

  const frame = document.getElementById("wiki-frame");

  frame.srcdoc = `
    <base href="https://en.wikipedia.org/wiki/">
    ${html}
  `;

  currentArticle = decodeURIComponent(title.replace(/_/g, " "));

  document.getElementById("game-current-article").textContent =
    currentArticle;

  document.getElementById("wiki-loading").style.display = "none";

  enableLinkTracking(frame);
}

// ─────────────────────────────────────────────
// LINK TRACKING (CORE GAME MECHANIC)
// ─────────────────────────────────────────────
function enableLinkTracking(frame) {
  frame.onload = () => {
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;

      doc.addEventListener("click", (e) => {
        const a = e.target.closest("a");
        if (!a) return;

        const href = a.getAttribute("href");
        if (!href || !href.startsWith("/wiki/")) return;

        e.preventDefault();

        clickCount++;
        updateClicks();

        const article = decodeURIComponent(href.split("/wiki/")[1]);

        currentArticle = article;
        document.getElementById("game-current-article").textContent =
          article.replace(/_/g, " ");

        socket.emit("game:navigate", {
          article: article.replace(/_/g, " "),
          url: href
        });

        loadWikipedia(href);
      });
    } catch (err) {
      console.log("Link tracking blocked:", err);
    }
  };
}

// ─────────────────────────────────────────────
// CLICK COUNTER
// ─────────────────────────────────────────────
function updateClicks() {
  document.getElementById("game-click-count").textContent = clickCount;
}

// ─────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────
socket.on("game:tick", ({ remaining }) => {
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;

  document.getElementById("timer-value").textContent =
    `${min}:${sec.toString().padStart(2, "0")}`;
});

// ─────────────────────────────────────────────
// GAME OVER
// ─────────────────────────────────────────────
socket.on("game:over", ({ leaderboard }) => {
  showScreen("game");

  document.getElementById("overlay-gameover").classList.remove("hidden");

  const list = document.getElementById("gameover-leaderboard");
  list.innerHTML = "";

  leaderboard.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.name} — ${p.clicks} clicks`;
    list.appendChild(li);
  });
});

// ─────────────────────────────────────────────
// LEAVE LOBBY
// ─────────────────────────────────────────────
document.getElementById("btn-leave-lobby").onclick = () => {
  location.reload();
};