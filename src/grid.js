const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function buildGrid(container, onCellClick, onCellHover, onCellLeave) {
    container.innerHTML = "";

    const corner = document.createElement("div");
    corner.className = "grid-header";
    container.appendChild(corner);

    for (const col of COLS) {
        const h = document.createElement("div");
        h.className = "grid-header";
        h.textContent = col;
        container.appendChild(h);
    }

    for (const row of ROWS) {
        const rh = document.createElement("div");
        rh.className = "grid-header";
        rh.textContent = row;
        container.appendChild(rh);

        for (const col of COLS) {
            const cell = document.createElement("div");
            cell.className = "grid-cell";
            cell.dataset.col = col;
            cell.dataset.row = row;
            if (onCellClick) cell.addEventListener("click", () => onCellClick(col, row));
            if (onCellHover) cell.addEventListener("mouseenter", () => onCellHover(col, row));
            if (onCellLeave) cell.addEventListener("mouseleave", () => onCellLeave(col, row));
            container.appendChild(cell);
        }
    }
}

export function getCell(container, col, row) {
    return container.querySelector(`[data-col="${col}"][data-row="${row}"]`);
}

export function setCell(container, col, row, letter) {
    const cell = getCell(container, col, row);
    if (!cell) return;
    if (letter === null) {
        cell.textContent = "✕";
        cell.classList.add("revealed-empty");
    } else {
        cell.textContent = letter;
        cell.classList.add("has-letter");
    }
}
