import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const wordArray = require("an-array-of-english-words");
const WORD_SET = new Set(wordArray.map(w => w.toUpperCase()));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, "dist")));
app.get("/play", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

// === Constants ===

const REQUIRED_LENGTHS = [3, 4, 5, 6, 7];
const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

// === Helpers ===

function colIndex(col) {
    return COLS.indexOf(col.toUpperCase());
}

function rowIndex(row) {
    return parseInt(row) - 1;
}

function makeBoard() {
    return Array.from({ length: 10 }, () => Array(10).fill(null));
}

function placementCells(word, col, row, direction) {
    const ci = colIndex(col);
    const ri = rowIndex(row);
    return word.split("").map((letter, i) => ({
        letter,
        ci: direction === "H" ? ci + i : ci,
        ri: direction === "H" ? ri : ri + i,
    }));
}

function generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code;
    do {
        code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    } while (rooms.has(code));
    return code;
}

function otherIdx(i) {
    return i === 0 ? 1 : 0;
}

function makePlayer(id, name) {
    return {
        id,
        name,
        board: makeBoard(),
        words: [],
        placements: [], // [{word, col, row, direction}, ...]
        ready: false,
        revealedCells: new Set(), // "col,row" keys of opponent cells this player has seen
        revealedLetters: new Set(), // letters revealed via roll-6
    };
}

function makeRoom(code) {
    return {
        code,
        phase: "lobby",
        players: [],
        currentTurn: 0,
        currentRoll: null,
        winner: null,
        reconnectTimer: null,
        playAgainVotes: new Set(),
        log: [],
    };
}

const rooms = new Map();

// === Placement validation ===

function validatePlacement(player, word, col, row, direction) {
    const upper = word.toUpperCase();

    if (!WORD_SET.has(upper))
        return `"${upper}" is not a valid word`;

    const len = upper.length;
    if (!REQUIRED_LENGTHS.includes(len))
        return `Words must be 3, 4, 5, 6, or 7 letters`;

    if (player.words.includes(upper))
        return `You already placed "${upper}"`;

    if (player.words.some(w => w.length === len))
        return `You already have a ${len}-letter word`;

    const cells = placementCells(upper, col, row, direction);

    if (cells.some(({ ci, ri }) => ci < 0 || ci > 9 || ri < 0 || ri > 9))
        return "Word goes out of bounds";

    // Cell conflict: each cell must be empty or have the exact matching letter
    for (const { letter, ci, ri } of cells) {
        const existing = player.board[ri][ci];
        if (existing !== null && existing !== letter)
            return "Word conflicts with a letter already placed at that position";
    }

    // Adjacency check
    const newCellSet = new Set(cells.map(({ ci, ri }) => `${ci},${ri}`));

    for (const existing of player.placements) {
        const existCells = placementCells(existing.word, existing.col, existing.row, existing.direction);
        const existCellSet = new Set(existCells.map(({ ci, ri }) => `${ci},${ri}`));

        // Reject if either word is entirely contained within the other
        const newAbsorbsExist = existCells.every(({ ci, ri }) => newCellSet.has(`${ci},${ri}`));
        const existAbsorbsNew = cells.every(({ ci, ri }) => existCellSet.has(`${ci},${ri}`));
        if (newAbsorbsExist || existAbsorbsNew)
            return `"${upper}" completely overlaps "${existing.word}" - words must remain distinct`;

        // Check if the new word shares a cell
        const crosses = cells.some(({ ci, ri }) => existCellSet.has(`${ci},${ri}`));
        if (crosses) continue;

        // Ensure no cell of the new word is orthogonally adjacent to this word
        for (const { ci, ri } of cells) {
            if (player.board[ri][ci] !== null) continue;
            for (const [dci, dri] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                if (existCellSet.has(`${ci + dci},${ri + dri}`))
                    return "Words cannot be directly adjacent to each other (unless they cross)";
            }
        }
    }

    return null;
}

function applyPlacement(player, word, col, row, direction) {
    const upper = word.toUpperCase();
    for (const { letter, ci, ri } of placementCells(upper, col, row, direction)) {
        player.board[ri][ci] = letter;
    }
    player.words.push(upper);
    player.placements.push({ word: upper, col, row, direction });
}

function removeWordFromPlayer(player, word) {
    const upper = word.toUpperCase();
    if (!player.words.includes(upper)) return false;
    player.words = player.words.filter(w => w !== upper);
    player.placements = player.placements.filter(p => p.word !== upper);
    // Rebuild board from remaining placements
    player.board = makeBoard();
    for (const p of player.placements) {
        for (const { letter, ci, ri } of placementCells(p.word, p.col, p.row, p.direction)) {
            player.board[ri][ci] = letter;
        }
    }
    return true;
}

// === Game logic ===

let nextRollOverride = null;

function rollDie() {
    if (nextRollOverride !== null) {
        const r = nextRollOverride;
        nextRollOverride = null;
        return r;
    }
    return Math.floor(Math.random() * 6) + 1;
}

function revealCoords(board, coords) {
    return coords.map(({ col, row }) => ({
        col,
        row,
        letter: board[rowIndex(row)][colIndex(col)],
    }));
}

function revealAllOfLetter(board, letter) {
    const upper = letter.toUpperCase();
    const results = [];
    for (let ri = 0; ri < 10; ri++) {
        for (let ci = 0; ci < 10; ci++) {
            if (board[ri][ci] === upper) {
                results.push({ col: COLS[ci], row: ri + 1, letter: upper });
            }
        }
    }
    return results;
}

function checkGuess(opponentWords, guessedWords) {
    const actual = [...opponentWords].map(w => w.toUpperCase()).sort();
    const guessed = [...guessedWords].map(w => w.toUpperCase().trim()).sort();
    if (actual.length !== guessed.length) return false;
    return actual.every((w, i) => w === guessed[i]);
}

// === Sockets ===

io.on("connection", (socket) => {
    let roomCode = null;
    let myIndex = null;

    function getRoom() {
        return rooms.get(roomCode);
    }

    function getMe() {
        return getRoom()?.players[myIndex];
    }

    function getOpponent() {
        return getRoom()?.players[otherIdx(myIndex)];
    }

    function endTurn() {
        const room = getRoom();
        room.currentRoll = null;
        room.currentTurn = otherIdx(room.currentTurn);
        io.to(roomCode).emit("turn-ended", { nextTurn: room.currentTurn });
    }

    // === Lobby ===

    socket.on("create-room", ({ name }) => {
        const code = generateCode();
        const room = makeRoom(code);
        room.players.push(makePlayer(socket.id, name));
        rooms.set(code, room);
        roomCode = code;
        myIndex = 0;
        socket.join(code);
        socket.emit("room-created", { code });
        socket.emit("player-joined", { players: room.players.map(p => p.name), yourIndex: 0 });
    });

    socket.on("join-room", ({ code, name }) => {
        const upper = (code || "").toUpperCase().trim();
        const room = rooms.get(upper);
        if (!room) return socket.emit("join-error", { message: "Room not found. Check your code." });

        // Reconnect: in-progress room with a disconnected slot whose name matches
        if (room.phase !== "lobby") {
            const dcIdx = room.players.findIndex(p => p.id === null && p.name === name);
            if (dcIdx !== -1) {
                const player = room.players[dcIdx];
                player.id = socket.id;
                roomCode = upper;
                myIndex = dcIdx;
                socket.join(upper);
                if (room.reconnectTimer) {
                    clearTimeout(room.reconnectTimer);
                    room.reconnectTimer = null;
                }
                socket.to(upper).emit("opponent-reconnected");
                socket.emit("reconnect-success", { phase: room.phase, myIndex: dcIdx, roomCode: upper, players: room.players.map(p => p.name) });
                if (room.phase === "setup") {
                    socket.emit("board-updated", { board: player.board, words: player.words });
                } else if (room.phase === "game") {
                    const opponent = room.players[otherIdx(dcIdx)];

                    // Cells the reconnecting player has revealed on the opponent's board
                    const revealedCells = [];
                    for (const key of player.revealedCells) {
                        const [col, rowStr] = key.split(",");
                        const rowNum = parseInt(rowStr);
                        revealedCells.push({ col, row: rowNum, letter: opponent.board[rowNum - 1][colIndex(col)] });
                    }

                    // Cells the opponent has revealed on the reconnecting player's board
                    const opponentRevealedCells = [];
                    for (const key of opponent.revealedCells) {
                        const [col, rowStr] = key.split(",");
                        const rowNum = parseInt(rowStr);
                        opponentRevealedCells.push({ col, row: rowNum, letter: player.board[rowNum - 1][colIndex(col)] });
                    }

                    socket.emit("game-resumed", {
                        players: room.players.map(p => p.name),
                        myBoard: player.board,
                        currentTurn: room.currentTurn,
                        currentRoll: room.currentRoll,
                        revealedCells,
                        opponentRevealedCells,
                        myRevealedLetters: [...player.revealedLetters],
                        gameLog: room.log,
                    });
                }
                return;
            }
            return socket.emit("join-error", { message: "That game is already in progress." });
        }

        if (room.players.length >= 2) return socket.emit("join-error", { message: "This room is already full." });

        room.players.push(makePlayer(socket.id, name));
        roomCode = upper;
        myIndex = 1;
        socket.join(upper);

        const playerNames = room.players.map(p => p.name);
        socket.emit("player-joined", { players: playerNames, yourIndex: 1 });
        socket.to(upper).emit("player-joined", { players: playerNames, yourIndex: 0 });

        room.phase = "setup";
        io.to(upper).emit("phase-change", { phase: "setup" });
    });

    // === Setup ===

    socket.on("place-word", ({ word, col, row, direction }) => {
        const room = getRoom();
        if (!room || room.phase !== "setup") return;
        const me = getMe();

        const error = validatePlacement(me, word, col, row, direction);
        if (error) return socket.emit("word-error", { message: error });

        applyPlacement(me, word, col, row, direction);
        socket.emit("board-updated", { board: me.board, words: me.words });
    });

    socket.on("remove-word", ({ word }) => {
        const room = getRoom();
        if (!room || room.phase !== "setup") return;
        const me = getMe();
        if (removeWordFromPlayer(me, word)) {
            socket.emit("board-updated", { board: me.board, words: me.words });
        }
    });

    socket.on("submit-board", () => {
        const room = getRoom();
        if (!room || room.phase !== "setup") return;
        const me = getMe();

        const missing = REQUIRED_LENGTHS.filter(len => !me.words.some(w => w.length === len));
        if (missing.length > 0)
            return socket.emit("word-error", { message: `Still need a ${missing[0]}-letter word` });

        me.ready = true;
        io.to(roomCode).emit("player-ready", { playerIndex: myIndex });

        if (room.players.length === 2 && room.players.every(p => p.ready)) {
            room.phase = "game";
            room.currentTurn = Math.random() < 0.5 ? 0 : 1;
            const names = room.players.map(p => p.name);
            room.log.push({ t: "start", firstTurn: room.currentTurn, names });
            io.to(roomCode).emit("game-starting", {
                firstTurn: room.currentTurn,
                players: names,
            });
        }
    });

    // === Game ===

    socket.on("roll-die", () => {
        const room = getRoom();
        if (!room || room.phase !== "game") return;
        if (room.currentTurn !== myIndex || room.currentRoll !== null) return;

        room.currentRoll = rollDie();
        room.log.push({ t: "roll", by: myIndex, roll: room.currentRoll });
        io.to(roomCode).emit("die-rolled", { roll: room.currentRoll, byPlayerIndex: myIndex });
    });

    socket.on("reveal-cell", ({ col, row }) => {
        const room = getRoom();
        if (!room || room.phase !== "game") return;
        if (room.currentTurn !== myIndex || room.currentRoll === null || room.currentRoll > 3) return;

        const me = getMe();
        const cells = revealCoords(getOpponent().board, [{ col, row }]);
        for (const { col: c, row: r } of cells) me.revealedCells.add(`${c},${r}`);
        room.log.push({ t: "reveal", by: myIndex, cells, letter: null });
        io.to(roomCode).emit("cells-revealed", { cells, byPlayerIndex: myIndex });
        endTurn();
    });

    socket.on("reveal-area", ({ col, row }) => {
        const room = getRoom();
        if (!room || room.phase !== "game") return;
        if (room.currentTurn !== myIndex || room.currentRoll === null || room.currentRoll < 4 || room.currentRoll > 5) return;

        const ci = colIndex(col);
        const ri = rowIndex(row);
        const coords = [];
        for (let dr = 0; dr <= 1; dr++) {
            for (let dc = 0; dc <= 1; dc++) {
                const nci = ci + dc;
                const nri = ri + dr;
                if (nci <= 9 && nri <= 9) coords.push({ col: COLS[nci], row: nri + 1 });
            }
        }

        const me = getMe();
        const cells = revealCoords(getOpponent().board, coords);
        for (const { col: c, row: r } of cells) me.revealedCells.add(`${c},${r}`);
        room.log.push({ t: "reveal", by: myIndex, cells, letter: null });
        io.to(roomCode).emit("cells-revealed", { cells, byPlayerIndex: myIndex });
        endTurn();
    });

    socket.on("reveal-letter", ({ letter }) => {
        const room = getRoom();
        if (!room || room.phase !== "game") return;
        if (room.currentTurn !== myIndex || room.currentRoll !== 6) return;

        const upper = letter.toUpperCase();
        const me = getMe();
        const opponent = getOpponent();

        if (me.revealedLetters.has(upper)) {
            return socket.emit("reveal-error", { message: `You already revealed all "${upper}"s with a previous roll.` });
        }

        const cells = revealAllOfLetter(opponent.board, upper);
        for (const { col: c, row: r } of cells) me.revealedCells.add(`${c},${r}`);
        me.revealedLetters.add(upper);
        room.log.push({ t: "reveal", by: myIndex, cells, letter: upper });
        io.to(roomCode).emit("cells-revealed", { cells, byPlayerIndex: myIndex, revealedLetter: upper });
        endTurn();
    });

    socket.on("guess-words", ({ words }) => {
        const room = getRoom();
        if (!room || room.phase !== "game") return;
        if (room.currentTurn !== myIndex) return;

        const opponent = getOpponent();
        if (checkGuess(opponent.words, words)) {
            room.phase = "finished";
            room.winner = getMe().name;
            const me = getMe();
            // Send each player their opponent's board
            socket.emit("game-over", {
                winnerIndex: myIndex,
                winner: room.winner,
                revealedWords: opponent.words,
                revealedBoard: opponent.board,
            });
            if (opponent.id) {
                io.to(opponent.id).emit("game-over", {
                    winnerIndex: myIndex,
                    winner: room.winner,
                    revealedWords: opponent.words,
                    revealedBoard: me.board,
                });
            }
        } else {
            room.log.push({ t: "guess", by: myIndex, words });
            io.to(roomCode).emit("guess-result", { correct: false, words, byPlayerIndex: myIndex });
            endTurn();
        }
    });

    socket.on("play-again", () => {
        const room = getRoom();
        if (!room || room.phase !== "finished") return;
        if (room.playAgainVotes.has(myIndex)) return;

        room.playAgainVotes.add(myIndex);
        io.to(roomCode).emit("play-again-update", { count: room.playAgainVotes.size });

        if (room.playAgainVotes.size === 2) {
            room.phase = "setup";
            room.currentTurn = 0;
            room.currentRoll = null;
            room.winner = null;
            room.playAgainVotes = new Set();
            room.log = [];
            for (const player of room.players) {
                player.board = makeBoard();
                player.words = [];
                player.placements = [];
                player.ready = false;
                player.revealedCells = new Set();
                player.revealedLetters = new Set();
            }
            io.to(roomCode).emit("rematch-start");
            io.to(roomCode).emit("phase-change", { phase: "setup" });
        }
    });

    socket.on("request-my-board", () => {
        const room = getRoom();
        if (!room) return;
        socket.emit("my-board", { board: getMe().board });
    });

    // === Test helpers ===

    if (process.env.NODE_ENV === "test") {
        socket.on("_set-roll", ({ roll }) => {
            nextRollOverride = roll;
        });
    }

    // === Disconnect ===

    socket.on("disconnect", () => {
        const room = getRoom();
        if (!room) return;

        if (room.phase === "lobby") {
            rooms.delete(roomCode);
            return;
        }

        const me = getMe();
        if (!me) return;
        me.id = null;

        const opponent = getOpponent();
        if (!opponent || opponent.id === null) {
            // Both players gone - clean up immediately
            if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
            rooms.delete(roomCode);
            return;
        }

        const RECONNECT_SECONDS = 60;
        socket.to(roomCode).emit("opponent-disconnected", { reconnectSeconds: RECONNECT_SECONDS });

        if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
        const dcIndex = myIndex;
        const dcRoomCode = roomCode;
        room.reconnectTimer = setTimeout(() => {
            const r = rooms.get(dcRoomCode);
            if (!r) return;
            const winner = r.players[otherIdx(dcIndex)];
            const loser = r.players[dcIndex];
            if (winner?.id) {
                io.to(winner.id).emit("game-over", {
                    winnerIndex: otherIdx(dcIndex),
                    winner: winner.name,
                    revealedWords: loser.words,
                    revealedBoard: loser.board,
                });
            }
            rooms.delete(dcRoomCode);
        }, RECONNECT_SECONDS * 1000);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Battle Words server: http://localhost:${PORT}`);
});

export { httpServer, io };
