export function initHome(socket, state, showScreen) {
    const nameInput = document.getElementById("home-name");
    const codeInput = document.getElementById("home-code");
    const btnCreate = document.getElementById("btn-create");
    const btnJoin = document.getElementById("btn-join");
    const errorEl = document.getElementById("home-error");

    const savedName = localStorage.getItem("bw-username");
    if (savedName) nameInput.value = savedName;

    function clearError() {
        errorEl.textContent = "";
    }

    function getName() {
        const name = nameInput.value.trim();
        if (!name) {
            errorEl.textContent = "Enter your name first.";
            return null;
        }
        clearError();
        localStorage.setItem("bw-username", name);
        return name;
    }

    btnCreate.addEventListener("click", () => {
        const name = getName();
        if (!name) return;
        state.myName = name;
        socket.emit("create-room", { name });
    });

    btnJoin.addEventListener("click", () => {
        const name = getName();
        if (!name) return;
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
            errorEl.textContent = "Enter a room code.";
            return;
        }
        state.myName = name;
        state.roomCode = code;
        socket.emit("join-room", { code, name });
    });

    codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value.toUpperCase();
    });

    nameInput.addEventListener("keydown", e => {
        if (e.key === "Enter") btnCreate.click();
    });

    codeInput.addEventListener("keydown", e => {
        if (e.key === "Enter") btnJoin.click();
    });

    socket.on("room-created", ({ code }) => {
        state.roomCode = code;
        showScreen("lobby");
    });

    // === Auto-reconnect on page reload ===

    let autoReconnecting = false;

    try {
        const token = JSON.parse(localStorage.getItem("bw-reconnect") || "null");
        if (token?.roomCode && token?.name && window.location.pathname === "/play") {
            autoReconnecting = true;
            state.myName = token.name;
            state.roomCode = token.roomCode;
            nameInput.value = token.name;
            errorEl.textContent = "Reconnecting to game...";
            socket.emit("join-room", { code: token.roomCode, name: token.name });
        }
    } catch { /* ignore malformed token */
    }

    socket.on("join-error", ({ message }) => {
        if (autoReconnecting) {
            autoReconnecting = false;
            localStorage.removeItem("bw-reconnect");
            errorEl.textContent = "";
            return;
        }
        errorEl.textContent = message;
    });

    socket.on("reconnect-success", ({ phase, myIndex: idx, roomCode: code, players }) => {
        autoReconnecting = false;
        state.myIndex = idx;
        state.roomCode = code;
        if (players) state.players = players;
        showScreen(phase === "setup" ? "setup" : "game");
    });
}
