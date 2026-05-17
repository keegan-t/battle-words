import { buildGrid, getCell } from "../grid.js";

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const REQUIRED_LENGTHS = [3, 4, 5, 6, 7];

const DEV_WORDS = [
    { word: "CAT", col: "A", row: 1, direction: "H" },
    { word: "WORD", col: "A", row: 3, direction: "H" },
    { word: "BRAVE", col: "A", row: 5, direction: "H" },
    { word: "CASTLE", col: "A", row: 7, direction: "H" },
    { word: "PERFECT", col: "A", row: 9, direction: "H" },
];

export function initSetup(socket, state, showScreen, showToast) {
    const gridEl = document.getElementById("setup-grid");
    const wordInput = document.getElementById("setup-word-input");
    const btnDirH = document.getElementById("btn-dir-h");
    const btnDirV = document.getElementById("btn-dir-v");
    const btnReady = document.getElementById("btn-ready");
    const wordSlotsEl = document.getElementById("word-slots");
    const statusEl = document.getElementById("setup-status");

    const devMode = new URLSearchParams(location.search).get("dev") === "1";
    let devAutoReady = false;

    let direction = "H";
    let confirmedWords = []; // string[] - server-confirmed word list
    let boardLetters = {}; // "col,row" -> letter
    let iReady = false;
    let hoveredCol = null;
    let hoveredRow = null;

    // === Direction toggle ===

    function setDirection(d) {
        direction = d;
        btnDirH.classList.toggle("active-dir", d === "H");
        btnDirV.classList.toggle("active-dir", d === "V");
        if (hoveredCol !== null) applyPreview(hoveredCol, hoveredRow);
    }

    btnDirH.addEventListener("click", () => setDirection("H"));
    btnDirV.addEventListener("click", () => setDirection("V"));

    wordInput.addEventListener("input", () => {
        wordInput.value = wordInput.value.toUpperCase().replace(/[^A-Z]/g, "");
        clearPreview();
    });

    wordInput.addEventListener("keydown", e => {
        if (e.key === "Tab") {
            e.preventDefault();
            setDirection(direction === "H" ? "V" : "H");
        }
    });

    // === Preview ===

    function getPreviewCells(col, row) {
        const word = wordInput.value.trim();
        if (!word) return [];
        const ci = COLS.indexOf(col);
        const ri = parseInt(row) - 1;
        return word.split("").map((letter, i) => ({
            letter,
            col: COLS[direction === "H" ? ci + i : ci],
            row: direction === "H" ? ri + 1 : ri + i + 1,
        })).filter(c => c.col !== undefined && c.row >= 1 && c.row <= 10);
    }

    function isPreviewValid(cells, word) {
        if (cells.length !== word.length) return false;
        for (const { col, row, letter } of cells) {
            const existing = boardLetters[`${col},${row}`];
            if (existing !== undefined && existing !== letter) return false;
        }
        return true;
    }

    function applyPreview(col, row) {
        clearPreview();
        const word = wordInput.value.trim();
        if (!word || iReady) return;
        const cells = getPreviewCells(col, row);
        const valid = isPreviewValid(cells, word);
        for (const { col: c, row: r } of cells) {
            const cell = getCell(gridEl, c, r);
            if (cell) cell.classList.add(valid ? "preview-valid" : "preview-invalid");
        }
    }

    function clearPreview() {
        for (const cell of gridEl.querySelectorAll(".preview-valid, .preview-invalid")) {
            cell.classList.remove("preview-valid", "preview-invalid");
        }
    }

    // === Grid interaction ===

    function onCellClick(col, row) {
        if (iReady) return;
        const word = wordInput.value.trim();
        if (!word) {
            showToast("Type a word first.", "error");
            wordInput.focus();
            return;
        }
        socket.emit("place-word", { word, col, row, direction });
        wordInput.focus();
    }

    buildGrid(gridEl, onCellClick, (c, r) => {
        hoveredCol = c;
        hoveredRow = r;
        applyPreview(c, r);
    }, () => {
        hoveredCol = null;
        hoveredRow = null;
        clearPreview();
    });
    renderWordSlots();

    // === Word slots panel ===

    function renderWordSlots() {
        wordSlotsEl.innerHTML = "";
        for (const len of REQUIRED_LENGTHS) {
            const placed = confirmedWords.find(w => w.length === len);
            const slot = document.createElement("div");
            slot.className = `word-slot${placed ? " filled" : ""}`;

            const label = document.createElement("span");
            label.className = "slot-label";
            label.textContent = `${len} letters`;
            slot.appendChild(label);

            if (placed) {
                const wordSpan = document.createElement("span");
                wordSpan.className = "slot-word";
                wordSpan.textContent = placed;
                slot.appendChild(wordSpan);

                const removeBtn = document.createElement("button");
                removeBtn.className = "slot-remove";
                removeBtn.textContent = "×";
                removeBtn.title = "Remove";
                removeBtn.addEventListener("click", () => socket.emit("remove-word", { word: placed }));
                slot.appendChild(removeBtn);
            }

            wordSlotsEl.appendChild(slot);
        }

        const allPlaced = REQUIRED_LENGTHS.every(len => confirmedWords.some(w => w.length === len));
        btnReady.disabled = !allPlaced || iReady;
        statusEl.textContent = iReady
            ? "Waiting for opponent..."
            : allPlaced
                ? "All words placed! Hit Ready when done."
                : `${confirmedWords.length} / 5 words placed`;

        if (devAutoReady && allPlaced && !iReady) {
            iReady = true;
            btnReady.disabled = true;
            statusEl.textContent = "Waiting for opponent...";
            socket.emit("submit-board");
        }
    }

    function rebuildBoardDisplay() {
        for (const cell of gridEl.querySelectorAll(".grid-cell")) {
            cell.textContent = "";
            cell.classList.remove("has-letter");
        }
        for (const [key, letter] of Object.entries(boardLetters)) {
            const [col, row] = key.split(",");
            const cell = getCell(gridEl, col, parseInt(row));
            if (cell) {
                cell.textContent = letter;
                cell.classList.add("has-letter");
            }
        }
    }

    // === Socket events ===

    socket.on("board-updated", ({ board, words }) => {
        confirmedWords = words;
        boardLetters = {};
        for (let ri = 0; ri < 10; ri++) {
            for (let ci = 0; ci < 10; ci++) {
                if (board[ri][ci] !== null) {
                    boardLetters[`${COLS[ci]},${ri + 1}`] = board[ri][ci];
                }
            }
        }
        rebuildBoardDisplay();
        renderWordSlots();
        wordInput.value = "";
        wordInput.focus();
    });

    socket.on("word-error", ({ message }) => {
        showToast(message, "error");
    });

    socket.on("player-ready", ({ playerIndex }) => {
        if (playerIndex !== state.myIndex) showToast("Opponent is ready!");
    });

    socket.on("phase-change", ({ phase }) => {
        if (phase === "setup" && devMode) {
            devAutoReady = true;
            for (const w of DEV_WORDS) socket.emit("place-word", w);
        }
    });

    socket.on("game-starting", () => {
        showScreen("game");
    });

    socket.on("rematch-start", () => {
        confirmedWords = [];
        boardLetters = {};
        iReady = false;
        devAutoReady = false;
        wordInput.value = "";
        clearPreview();
        rebuildBoardDisplay();
        renderWordSlots();
    });

    // === Ready button ===

    btnReady.addEventListener("click", () => {
        socket.emit("submit-board");
        iReady = true;
        btnReady.disabled = true;
        statusEl.textContent = "Waiting for opponent...";
    });
}
