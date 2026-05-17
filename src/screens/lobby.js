export function initLobby(socket, state, showScreen, showToast) {
    const codeEl = document.getElementById("lobby-code");
    const playersEl = document.getElementById("lobby-players");
    const codeBlock = document.getElementById("room-code-block");

    codeBlock.addEventListener("click", () => {
        navigator.clipboard.writeText(state.roomCode).then(() => {
            showToast("Room code copied!");
        });
    });

    socket.on("player-joined", ({ players, yourIndex }) => {
        state.myIndex = yourIndex;
        state.players = players;
        codeEl.textContent = state.roomCode;
        history.pushState({}, "", "/play" + location.search);
        localStorage.setItem("bw-reconnect", JSON.stringify({ roomCode: state.roomCode, name: state.myName }));

        playersEl.innerHTML = "";
        for (let i = 0; i < 2; i++) {
            const div = document.createElement("div");
            if (i < players.length) {
                div.className = "lobby-player";
                div.innerHTML = `<span class="dot"></span><span>${players[i]}${i === yourIndex ? " (you)" : ""}</span>`;
            } else {
                div.className = "lobby-player waiting";
                div.innerHTML = `<span class="dot"></span><span style="color:var(--text-muted)">Waiting for player 2...</span>`;
            }
            playersEl.appendChild(div);
        }

        // Update title based on whether room is full
        const h2 = document.querySelector("#screen-lobby h2");
        if (players.length >= 2) {
            h2.textContent = "Both players connected!";
        } else {
            h2.textContent = "Waiting for opponent...";
        }
    });

    socket.on("phase-change", ({ phase }) => {
        if (phase === "setup") showScreen("setup");
    });
}
