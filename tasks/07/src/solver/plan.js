import { rotationDistance } from "./rotate.js";

export const createPlan = (currentBoard, targetBoard) => {
    const moves = [];

    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            const current = currentBoard.getCell(row, col);
            const target = targetBoard.getCell(row, col);
            const turns = rotationDistance(current.openings, target.openings);

            if (turns === null) {
                throw new Error(`Unable to align tile at ${row + 1}x${col + 1}`);
            }

            for (let index = 0; index < turns; index += 1) {
                moves.push({ row, col, rotate: `${row + 1}x${col + 1}` });
            }
        }
    }

    return moves;
};
