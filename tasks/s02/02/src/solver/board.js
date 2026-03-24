import { rotateOpeningsClockwise } from "./rotate.js";

export class Board {
    constructor(cells) {
        this.cells = cells.map((row) => row.map((cell) => ({ ...cell, openings: [...cell.openings].sort() })));
    }

    clone() {
        return new Board(this.cells);
    }

    getCell(row, col) {
        return this.cells[row][col];
    }

    rotate(row, col) {
        const cell = this.getCell(row, col);
        cell.openings = rotateOpeningsClockwise(cell.openings);
        cell.rotation = ((cell.rotation ?? 0) + 1) % 4;
        return cell;
    }

    toComparable() {
        return this.cells.map((row) => row.map((cell) => cell.openings.join("")));
    }

    matches(otherBoard) {
        return JSON.stringify(this.toComparable()) === JSON.stringify(otherBoard.toComparable());
    }
}
