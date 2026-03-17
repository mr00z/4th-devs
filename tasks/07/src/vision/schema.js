const normalizeOpenings = (openings) => [...new Set(openings)].sort();

export const normalizeBoardSchema = (payload) => {
    if (!payload || !Array.isArray(payload.cells) || payload.cells.length !== 3) {
        throw new Error("Vision output must contain a 3x3 cells matrix");
    }

    return payload.cells.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== 3) {
            throw new Error(`Vision row ${rowIndex + 1} must contain 3 cells`);
        }

        return row.map((cell, colIndex) => ({
            row: rowIndex,
            col: colIndex,
            type: cell.type || "unknown",
            openings: normalizeOpenings(cell.openings || []),
            rotation: Number.isInteger(cell.rotation) ? cell.rotation % 4 : 0,
            confidence: typeof cell.confidence === "number" ? cell.confidence : null
        }));
    });
};
