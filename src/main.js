import { socket } from "./socket.js";
import { initHome } from "./screens/home.js";
import { initLobby } from "./screens/lobby.js";
import { initSetup } from "./screens/setup.js";
import { initGame } from "./screens/game.js";

// === Shared state ===

export const state = {
    myName: "",
    myIndex: null,
    roomCode: "",
};

// === Screen management ===

const screens = {
    home: document.getElementById("screen-home"),
    lobby: document.getElementById("screen-lobby"),
    setup: document.getElementById("screen-setup"),
    game: document.getElementById("screen-game"),
};

export function showScreen(name) {
    for (const el of Object.values(screens)) el.classList.remove("active");
    screens[name].classList.add("active");
}

// === Toast ===

const toastContainer = document.getElementById("toast-container");

export function showToast(message, type = "") {
    const el = document.createElement("div");
    el.className = `toast${type ? " " + type : ""}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3200);
}

// === Init ===

function updateGridSize() {
    const header = document.querySelector(".site-header");
    const headerH = header ? header.offsetHeight : 60;

    // Fill available vertical space
    const heightBased = Math.floor(window.innerHeight - headerH - 64 - 50);

    // Medium-wide resolution horizonal space
    const widthBased = Math.floor((window.innerWidth - 208) * 0.58);

    const gameSize = Math.max(280, Math.min(heightBased, widthBased));
    document.documentElement.style.setProperty("--grid-size", `${gameSize}px`);

    // Setup grid
    const setupHeightBased = Math.floor(heightBased - 41 - 12);
    const setupWidthBased = Math.floor(window.innerWidth - 460);
    const setupSize = Math.max(280, Math.min(setupHeightBased, setupWidthBased));
    document.documentElement.style.setProperty("--setup-grid-size", `${setupSize}px`);
}

window.addEventListener("resize", updateGridSize);
updateGridSize();

// === Rules modal ===

const rulesModal = document.getElementById("rules-modal");
const btnRules = document.getElementById("btn-rules");
const btnRulesClose = document.getElementById("btn-rules-close");

btnRules.addEventListener("click", () => rulesModal.classList.remove("hidden"));
btnRulesClose.addEventListener("click", () => rulesModal.classList.add("hidden"));
rulesModal.addEventListener("click", e => {
    if (e.target === rulesModal) rulesModal.classList.add("hidden");
});

initHome(socket, state, showScreen);
initLobby(socket, state, showScreen, showToast);
initSetup(socket, state, showScreen, showToast);
initGame(socket, state, showScreen, showToast);
