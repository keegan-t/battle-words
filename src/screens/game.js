import { buildGrid, getCell, setCell } from "../grid.js";

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const REQUIRED_LENGTHS = [3, 4, 5, 6, 7];

const PIP_POSITIONS = { // For die rendering
    1: [[2, 2]],
    2: [[1, 3], [3, 1]],
    3: [[1, 3], [2, 2], [3, 1]],
    4: [[1, 1], [1, 3], [3, 1], [3, 3]],
    5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
    6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

export function initGame(socket, state, showScreen, showToast) {
    const opponentGridEl = document.getElementById("opponent-grid");
    const myGridEl = document.getElementById("my-grid");
    const turnBanner = document.getElementById("turn-banner");
    const dieFaceEl = document.getElementById("die-face");
    const btnRoll = document.getElementById("btn-roll");
    const actionPrompt = document.getElementById("action-prompt");
    const btnGuessWords = document.getElementById("btn-guess-words");
    const gameLogEl = document.getElementById("game-log");

    const guessModal = document.getElementById("guess-modal");
    const guessInputsEl = document.getElementById("guess-inputs");
    const btnGuessCancel = document.getElementById("btn-guess-cancel");
    const btnGuessSubmit = document.getElementById("btn-guess-submit");

    const gameoverOverlay = document.getElementById("screen-gameover");
    const gameoverResult = document.getElementById("gameover-result");
    const gameoverTitle = document.getElementById("gameover-title");
    const gameoverSub = document.getElementById("gameover-subtitle");
    const gameoverWords = document.getElementById("gameover-words");
    const btnGameoverClose = document.getElementById("btn-gameover-close");

    let currentRoll = null;
    let isMyTurn = false;
    let actionMode = null; // "cell" | "area" | "letter"
    let gamePhase = "waiting"; // "waiting" | "rolling" | "acting"
    let playerNames = [];
    let reconnectInterval = null;
    let reconnectBannerEl = null;
    let revealedLetters = new Set();
    let playAgainToast = null;

    const revealedSectionEl = document.getElementById("revealed-letters-section");
    const revealedChipsEl = document.getElementById("revealed-letters-chips");

    function addRevealedLetterChip(letter) {
        if (revealedLetters.has(letter)) return;
        revealedLetters.add(letter);
        revealedSectionEl.classList.remove("hidden");
        const chip = document.createElement("span");
        chip.className = "revealed-letter-chip";
        chip.textContent = letter;
        revealedChipsEl.appendChild(chip);
    }

    // === Grid setup ===

    function onOpponentCellClick(col, row) {
        if (!isMyTurn || actionMode === null) return;

        if (actionMode === "cell") {
            clearAreaHover();
            socket.emit("reveal-cell", { col, row });
            setActionMode(null);
        } else if (actionMode === "area") {
            clearAreaHover();
            socket.emit("reveal-area", { col, row });
            setActionMode(null);
        }
    }

    function onOpponentCellHover(col, row) {
        if (!isMyTurn || actionMode !== "area") return;
        clearAreaHover();
        const ci = COLS.indexOf(col);
        const ri = parseInt(row) - 1;
        for (let dc = 0; dc <= 1; dc++) {
            for (let dr = 0; dr <= 1; dr++) {
                const nc = COLS[ci + dc];
                const nr = ri + dr + 1;
                if (nc && nr >= 1 && nr <= 10) {
                    const cell = getCell(opponentGridEl, nc, nr);
                    if (cell) cell.classList.add("area-hover");
                }
            }
        }
    }

    function onOpponentCellLeave() {
        clearAreaHover();
    }

    function clearAreaHover() {
        for (const cell of opponentGridEl.querySelectorAll(".area-hover")) {
            cell.classList.remove("area-hover");
        }
    }

    buildGrid(opponentGridEl, onOpponentCellClick, onOpponentCellHover, onOpponentCellLeave);
    buildGrid(myGridEl, null, null, null);

    // Disable user grid interactivity
    for (const cell of myGridEl.querySelectorAll(".grid-cell")) {
        cell.classList.add("no-action", "no-hover");
    }

    // === Turn / UI state ===

    function setMyTurn(myTurn) {
        isMyTurn = myTurn;
        turnBanner.textContent = myTurn ? "Your Turn" : `${getOpponentName()}'s Turn`;
        turnBanner.className = `turn-banner${myTurn ? " your-turn" : ""}`;
        btnRoll.disabled = !myTurn;
        btnGuessWords.disabled = !myTurn;
        if (myTurn) {
            gamePhase = "rolling";
            setActionMode(null);
            actionPrompt.textContent = "Roll the die to take your turn, or guess all words.";
            actionPrompt.classList.remove("active");
        } else {
            gamePhase = "waiting";
            actionPrompt.textContent = `Waiting for ${getOpponentName()} to roll...`;
            actionPrompt.classList.remove("active");
        }
        currentRoll = null;
    }

    function setActionMode(mode) {
        actionMode = mode;
        clearAreaHover();
        document.getElementById("letter-reveal-ui")?.remove();

        const msgs = {
            cell: "Click a cell on the opponent's board to reveal it.",
            area: "Click the top-left cell of a 2×2 area to reveal it.",
            letter: null,
        };

        if (mode === "letter") {
            promptLetterInput();
        } else if (mode) {
            actionPrompt.textContent = msgs[mode];
            actionPrompt.classList.add("active");
        } else {
            actionPrompt.classList.remove("active");
        }

        // Highlight/dim opponent grid cells based on mode
        for (const cell of opponentGridEl.querySelectorAll(".grid-cell")) {
            cell.classList.toggle("no-hover", mode === null);
        }
    }

    function promptLetterInput() {
        document.getElementById("letter-reveal-ui")?.remove();

        const ui = document.createElement("div");
        ui.id = "letter-reveal-ui";
        ui.className = "letter-reveal-ui";

        const label = document.createElement("p");
        label.className = "letter-reveal-label";
        label.textContent = "Reveal all positions of a letter:";

        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 1;
        input.placeholder = "?";
        input.className = "letter-reveal-input";
        input.autocomplete = "off";

        const btn = document.createElement("button");
        btn.textContent = "Reveal";
        btn.className = "btn btn-primary";

        const doReveal = () => {
            const letter = input.value.trim().toUpperCase();
            if (!letter || !/^[A-Z]$/.test(letter)) {
                input.focus();
                return;
            }
            btn.disabled = true;
            socket.emit("reveal-letter", { letter });
        };

        btn.addEventListener("click", doReveal);
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") doReveal();
        });
        input.addEventListener("input", () => {
            input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "");
        });

        ui.appendChild(label);
        ui.appendChild(input);
        ui.appendChild(btn);

        actionPrompt.innerHTML = "";
        actionPrompt.classList.remove("active");
        actionPrompt.after(ui);
        setTimeout(() => input.focus(), 50);
    }

    function getOpponentName() {
        return playerNames[state.myIndex === 0 ? 1 : 0] || "Opponent";
    }

    function renderDie(roll) {
        dieFaceEl.innerHTML = "";
        if (!roll) return;
        for (const [row, col] of PIP_POSITIONS[roll]) {
            const pip = document.createElement("div");
            pip.className = "die-pip";
            pip.style.gridRow = row;
            pip.style.gridColumn = col;
            dieFaceEl.appendChild(pip);
        }
    }

    // === Log ===

    function log(msg, highlight = false) {
        const entry = document.createElement("div");
        entry.className = `log-entry${highlight ? " highlight" : ""}`;
        entry.textContent = msg;
        gameLogEl.prepend(entry);
    }

    // === Roll ===

    btnRoll.addEventListener("click", () => {
        if (!isMyTurn || gamePhase !== "rolling") return;
        socket.emit("roll-die");
        btnRoll.disabled = true;
        btnGuessWords.disabled = true;
    });

    // === Guess words modal ===

    btnGuessWords.addEventListener("click", () => {
        if (!isMyTurn) return;
        openGuessModal();
    });

    function openGuessModal() {
        guessInputsEl.innerHTML = "";
        for (const len of REQUIRED_LENGTHS) {
            const row = document.createElement("div");
            row.className = "guess-input-row";

            const label = document.createElement("span");
            label.className = "guess-input-label";
            label.textContent = `${len} letters`;

            const input = document.createElement("input");
            input.type = "text";
            input.maxLength = len;
            input.placeholder = "-".repeat(len);
            input.dataset.len = len;
            input.autocomplete = "off";
            input.addEventListener("input", () => {
                input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "");
            });

            row.appendChild(label);
            row.appendChild(input);
            guessInputsEl.appendChild(row);
        }
        guessModal.classList.remove("hidden");
        guessInputsEl.querySelector("input")?.focus();
    }

    btnGuessCancel.addEventListener("click", () => {
        guessModal.classList.add("hidden");
    });

    btnGuessSubmit.addEventListener("click", () => {
        const inputs = [...guessInputsEl.querySelectorAll("input")];
        const words = inputs.map(i => i.value.trim().toUpperCase());
        if (words.some(w => !w)) {
            showToast("Fill in all 5 words first.", "error");
            return;
        }
        socket.emit("guess-words", { words });
        guessModal.classList.add("hidden");
    });

    // === Socket events ===

    socket.on("game-starting", ({ firstTurn, players }) => {
        localStorage.setItem("bw-reconnect", JSON.stringify({ roomCode: state.roomCode, name: state.myName }));
        playerNames = players;
        setMyTurn(firstTurn === state.myIndex);
        log(`Game started! ${players[firstTurn]} goes first.`, true);
        socket.emit("request-my-board");
    });

    socket.on("my-board", ({ board }) => {
        for (let ri = 0; ri < 10; ri++) {
            for (let ci = 0; ci < 10; ci++) {
                const letter = board[ri][ci];
                if (letter) {
                    const cell = getCell(myGridEl, COLS[ci], ri + 1);
                    if (cell) {
                        cell.textContent = letter;
                        cell.classList.add("has-letter");
                    }
                }
            }
        }
    });

    socket.on("die-rolled", ({ roll, byPlayerIndex }) => {
        currentRoll = roll;
        dieFaceEl.classList.remove("rolling");
        void dieFaceEl.offsetWidth;
        dieFaceEl.classList.add("rolling");
        renderDie(roll);

        const byMe = byPlayerIndex === state.myIndex;
        const rollerName = byMe ? "You" : getOpponentName();
        log(`${rollerName} rolled a ${roll}.`);

        if (byMe) {
            gamePhase = "acting";
            btnRoll.disabled = true;
            if (roll <= 3) setActionMode("cell");
            else if (roll <= 5) setActionMode("area");
            else setActionMode("letter");
        } else {
            actionPrompt.textContent = `${getOpponentName()} rolled a ${roll}. Waiting for their action...`;
        }
    });

    socket.on("cells-revealed", ({ cells, byPlayerIndex, revealedLetter }) => {
        const byMe = byPlayerIndex === state.myIndex;

        if (byMe) {
            for (const { col, row, letter } of cells) {
                setCell(opponentGridEl, col, row, letter);
            }

            if (revealedLetter) {
                addRevealedLetterChip(revealedLetter);
                if (cells.length === 0) {
                    log(`You revealed "${revealedLetter}" - none on the board.`);
                } else {
                    log(`You revealed all ${cells.length} "${revealedLetter}"${cells.length > 1 ? "s" : ""}: ${cells.map(c => `${c.col}${c.row}`).join(", ")}`, true);
                }
            } else {
                const hits = cells.filter(c => c.letter !== null);
                const misses = cells.filter(c => c.letter === null);
                if (hits.length > 0) log(`You revealed: ${hits.map(c => `${c.col}${c.row}=${c.letter}`).join(", ")}`, true);
                if (misses.length > 0) log(`${misses.length} empty cell${misses.length > 1 ? "s" : ""}.`);
            }
        } else {
            for (const { col, row, letter } of cells) {
                const cell = getCell(myGridEl, col, row);
                if (!cell) continue;
                if (letter !== null) {
                    cell.classList.add("opponent-hit");
                } else {
                    cell.textContent = "✕";
                    cell.classList.add("opponent-miss");
                }
            }

            if (revealedLetter) {
                if (cells.length === 0) {
                    log(`${getOpponentName()} revealed "${revealedLetter}" - none on your board.`);
                } else {
                    log(`${getOpponentName()} revealed all "${revealedLetter}"s (${cells.length} cell${cells.length > 1 ? "s" : ""}).`);
                }
            } else {
                const hits = cells.filter(c => c.letter !== null);
                const misses = cells.filter(c => c.letter === null);
                if (hits.length > 0) log(`${getOpponentName()} found: ${hits.map(c => `${c.col}${c.row}=${c.letter}`).join(", ")}`, false);
                if (misses.length > 0) log(`${getOpponentName()} missed ${misses.length} cell${misses.length > 1 ? "s" : ""}.`);
            }
        }
    });

    socket.on("turn-ended", ({ nextTurn }) => {
        const myTurn = nextTurn === state.myIndex;
        setMyTurn(myTurn);
        if (myTurn) showToast("Your turn!");
    });

    socket.on("reveal-error", ({ message }) => {
        showToast(message, "error");
        const ui = document.getElementById("letter-reveal-ui");
        if (ui) {
            const uiBtn = ui.querySelector(".btn");
            const uiInput = ui.querySelector("input");
            if (uiBtn) uiBtn.disabled = false;
            if (uiInput) {
                uiInput.value = "";
                uiInput.focus();
            }
        }
    });

    socket.on("guess-result", ({ correct, words, byPlayerIndex }) => {
        if (!correct) {
            const byMe = byPlayerIndex === state.myIndex;
            const wordList = words.map(w => w.toUpperCase()).join(", ");
            if (byMe) {
                showToast("Wrong guess - turn forfeited.", "error");
                log(`You guessed wrong (${wordList}) - turn forfeited.`);
            } else {
                log(`${getOpponentName()} guessed: ${wordList} - wrong!`);
            }
        }
    });

    socket.on("game-over", ({ winnerIndex, winner, revealedWords, revealedBoard }) => {
        localStorage.removeItem("bw-reconnect");
        const iWon = winnerIndex === state.myIndex;
        const wordList = revealedWords.map(w => w.toUpperCase()).join(", ");
        if (iWon) {
            log(`You correctly guessed: ${wordList}. You win!`, true);
        } else {
            log(`${winner} correctly guessed your words: ${wordList}.`);
        }

        // Reveal full opponent board
        for (let ri = 0; ri < 10; ri++) {
            for (let ci = 0; ci < 10; ci++) {
                const letter = revealedBoard[ri][ci];
                if (!letter) continue;
                const cell = getCell(opponentGridEl, COLS[ci], ri + 1);
                if (!cell || cell.classList.contains("has-letter")) continue;
                cell.textContent = letter;
                cell.classList.add("end-reveal");
            }
        }

        gameoverResult.textContent = iWon ? "🏆" : "💀";
        gameoverTitle.textContent = iWon ? "You win!" : `${winner} wins!`;
        gameoverSub.textContent = iWon
            ? `You correctly guessed all of ${getOpponentName()}'s words!`
            : `${winner} correctly guessed all of your words.`;

        gameoverWords.innerHTML = "";
        for (const word of [...revealedWords].sort((a, b) => a.length - b.length)) {
            const span = document.createElement("span");
            span.className = "gameover-word";
            span.textContent = word;
            gameoverWords.appendChild(span);
        }

        setTimeout(() => {
            gameoverOverlay.classList.remove("hidden");
            showPlayAgainNotification();
        }, 600);
    });

    function showReconnectBanner(seconds) {
        hideReconnectBanner();
        let remaining = seconds;

        reconnectBannerEl = document.createElement("div");
        reconnectBannerEl.className = "toast reconnect-banner";

        const title = document.createElement("div");
        title.className = "reconnect-banner-title";
        title.textContent = "Opponent disconnected";

        const countdown = document.createElement("div");
        countdown.className = "reconnect-banner-countdown";
        countdown.textContent = `Reconnecting... ${remaining}s`;

        reconnectBannerEl.appendChild(title);
        reconnectBannerEl.appendChild(countdown);
        document.getElementById("toast-container").appendChild(reconnectBannerEl);

        reconnectInterval = setInterval(() => {
            remaining--;
            countdown.textContent = remaining > 0 ? `Reconnecting... ${remaining}s` : "Reconnect time expired.";
            if (remaining <= 0) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
        }, 1000);
    }

    function hideReconnectBanner() {
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
        if (reconnectBannerEl) {
            reconnectBannerEl.remove();
            reconnectBannerEl = null;
        }
    }

    socket.on("opponent-disconnected", ({ reconnectSeconds }) => {
        showReconnectBanner(reconnectSeconds);
        log(`${getOpponentName()} disconnected. ${reconnectSeconds}s to reconnect.`);
    });

    socket.on("opponent-reconnected", () => {
        hideReconnectBanner();
        showToast(`${getOpponentName()} reconnected!`);
        log(`${getOpponentName()} reconnected. Game continuing.`, true);
    });

    socket.on("game-resumed", ({ players, myBoard, currentTurn, currentRoll: resumedRoll }) => {
        playerNames = players;

        for (let ri = 0; ri < 10; ri++) {
            for (let ci = 0; ci < 10; ci++) {
                const letter = myBoard[ri][ci];
                if (letter) {
                    const cell = getCell(myGridEl, COLS[ci], ri + 1);
                    if (cell) {
                        cell.textContent = letter;
                        cell.classList.add("has-letter");
                    }
                }
            }
        }

        setMyTurn(currentTurn === state.myIndex);

        if (resumedRoll) {
            currentRoll = resumedRoll;
            renderDie(resumedRoll);
            btnRoll.disabled = true;
            btnGuessWords.disabled = true;
            if (currentTurn === state.myIndex) {
                gamePhase = "acting";
                if (resumedRoll <= 3) setActionMode("cell");
                else if (resumedRoll <= 5) setActionMode("area");
                else setActionMode("letter");
            } else {
                actionPrompt.textContent = `${getOpponentName()} rolled a ${resumedRoll}. Waiting for their action...`;
            }
        }

        showToast("Reconnected to game!");
        log("Reconnected to game.", true);
    });

    // === Game over helpers ===

    btnGameoverClose.addEventListener("click", () => {
        gameoverOverlay.classList.add("hidden");
    });

    function showPlayAgainNotification() {
        if (playAgainToast) playAgainToast.remove();
        playAgainToast = document.createElement("div");
        playAgainToast.className = "toast play-again-toast";

        const label = document.createElement("div");
        label.className = "play-again-label";
        label.textContent = "Play Again? (0/2)";

        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = "Play Again";
        btn.addEventListener("click", () => {
            btn.disabled = true;
            socket.emit("play-again");
        });

        playAgainToast.appendChild(label);
        playAgainToast.appendChild(btn);
        document.getElementById("toast-container").appendChild(playAgainToast);
    }

    socket.on("play-again-update", ({ count }) => {
        if (playAgainToast) {
            const label = playAgainToast.querySelector(".play-again-label");
            if (label) label.textContent = `Play Again? (${count}/2)`;
        }
    });

    socket.on("rematch-start", () => {
        hideReconnectBanner();

        buildGrid(opponentGridEl, onOpponentCellClick, onOpponentCellHover, onOpponentCellLeave);
        buildGrid(myGridEl, null, null, null);
        for (const cell of myGridEl.querySelectorAll(".grid-cell")) {
            cell.classList.add("no-action", "no-hover");
        }
        for (const cell of opponentGridEl.querySelectorAll(".grid-cell")) {
            cell.classList.add("no-hover");
        }

        gameLogEl.innerHTML = "";
        dieFaceEl.innerHTML = "";
        dieFaceEl.classList.remove("rolling");
        document.getElementById("letter-reveal-ui")?.remove();
        actionPrompt.textContent = "";
        actionPrompt.classList.remove("active");
        gameoverOverlay.classList.add("hidden");

        revealedLetters.clear();
        revealedChipsEl.innerHTML = "";
        revealedSectionEl.classList.add("hidden");

        currentRoll = null;
        isMyTurn = false;
        actionMode = null;
        gamePhase = "waiting";

        if (playAgainToast) {
            playAgainToast.remove();
            playAgainToast = null;
        }

        showScreen("setup");
    });

    renderDie(1);
    return { renderDie };
}
