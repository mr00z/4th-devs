import { Board } from "./solver/board.js";
import { fetchPuzzleImage, rotateTile } from "./api.js";
import { puzzleConfig } from "./config.js";
import log from "./helpers/logger.js";
import { analyzeBoardImage } from "./vision/analyze.js";
import { reasonNextMove } from "./main-agent/reason.js";

export const MAIN_AGENT_PROMPT = [
    "You are the main reasoning agent for a 3x3 electricity rotation puzzle.",
    "The only allowed action in the real environment is rotating one chosen tile 90 degrees clockwise.",
    "You do not read raw images directly. A separate vision sub-agent converts images into structured board states.",
    "Treat the structured board state as the source of truth unless a later checkpoint disproves it.",
    "Your job is to compare the current board against the target board and decide what rotation or sequence of rotations is required.",
    "A tile may only change orientation, never shape. Straight stays straight, elbow stays elbow, tee stays tee, cap stays cap, empty stays empty.",
    "If a current tile and target tile at the same position are not rotationally compatible, assume perception or target mapping is wrong and request re-analysis rather than forcing a move.",
    "Minimize vision usage. Prefer maintaining board state in memory after each successful rotate action.",
    "Prefer deterministic reasoning over exploration. For each move, explain which tile is rotated, why it is rotatable into the target orientation, and what the resulting openings will be.",
    "Never invent missing board structure. If confidence is low or a mismatch exists, surface the mismatch explicitly.",
    "The task is complete only when the verify API returns a flag in {FLG:...} format."
].join(" ");

const DEFAULT_TARGET_CELLS = [
    [
        { type: "elbow", openings: ["E", "S"], rotation: 0, confidence: 1 },
        { type: "tee", openings: ["E", "S", "W"], rotation: 0, confidence: 1 },
        { type: "cap", openings: ["W"], rotation: 0, confidence: 1 }
    ],
    [
        { type: "straight", openings: ["N", "S"], rotation: 0, confidence: 1 },
        { type: "tee", openings: ["E", "N", "S"], rotation: 0, confidence: 1 },
        { type: "tee", openings: ["E", "S", "W"], rotation: 0, confidence: 1 }
    ],
    [
        { type: "tee", openings: ["N", "E", "W"], rotation: 0, confidence: 1 },
        { type: "elbow", openings: ["N", "W"], rotation: 0, confidence: 1 },
        { type: "elbow", openings: ["N", "E"], rotation: 0, confidence: 1 }
    ]
];

const canAlignCell = (currentCell, targetCell) => {
    if (currentCell.type === targetCell.type) {
        return true;
    }

    const currentOpenings = [...currentCell.openings].sort().join("");
    const targetOpenings = [...targetCell.openings].sort().join("");
    return currentOpenings.length === targetOpenings.length;
};

const maybeCheckpoint = async (moveIndex) => {
    if (!puzzleConfig.checkpointEveryMoves) {
        return null;
    }

    if ((moveIndex + 1) % puzzleConfig.checkpointEveryMoves !== 0) {
        return null;
    }

    log.start(`Checkpoint fetch after ${moveIndex + 1} moves`);
    return fetchPuzzleImage();
};

export const run = async () => {
    log.data("main-agent-prompt", MAIN_AGENT_PROMPT);
    log.info(`Main model: ${puzzleConfig.mainModel}`);
    log.info(`Vision model: ${puzzleConfig.visionModel}`);
    log.info(`Verify endpoint: ${puzzleConfig.verifyUrl}`);
    log.info(`Checkpoint frequency: ${puzzleConfig.checkpointEveryMoves || 0}`);
    log.info(`Target source: ${puzzleConfig.useTargetVision ? "vision" : "built-in topology"}`);

    log.start("Fetching live puzzle image");
    const liveImage = await fetchPuzzleImage();
    log.success(`Live image stored at ${liveImage.path}`);

    const targetCells = puzzleConfig.useTargetVision
        ? await analyzeBoardImage({
            imagePath: puzzleConfig.targetImagePath,
            label: "target"
        })
        : DEFAULT_TARGET_CELLS;

    log.data("target-cells", targetCells);

    log.start("Analyzing current board");
    const currentCells = await analyzeBoardImage({
        imagePath: puzzleConfig.liveImagePath,
        label: "current"
    });
    log.data("current-cells", currentCells);

    const targetBoard = new Board(targetCells);
    const currentBoard = new Board(currentCells);
    log.data("target-board", targetBoard.toComparable());
    log.data("current-board", currentBoard.toComparable());

    const lowConfidenceCells = [];
    const lowConfidenceThreshold = 0.75;
    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            const cell = currentBoard.getCell(row, col);
            if ((cell.confidence ?? 1) < lowConfidenceThreshold) {
                lowConfidenceCells.push({
                    position: `${row + 1}x${col + 1}`,
                    confidence: cell.confidence,
                    type: cell.type,
                    openings: cell.openings
                });
            }
        }
    }

    if (lowConfidenceCells.length > 0) {
        log.warn("Low-confidence vision cells detected; stopping before planning");
        log.data("low-confidence-cells", lowConfidenceCells);
        return {
            solved: false,
            flag: null,
            needs_review: true,
            reason: "low_confidence_vision",
            lowConfidenceCells,
            currentBoard: currentBoard.toComparable(),
            targetBoard: targetBoard.toComparable()
        };
    }

    log.info(`Vision confidence gate passed (threshold ${lowConfidenceThreshold})`);

    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            const currentCell = currentBoard.getCell(row, col);
            const targetCell = targetBoard.getCell(row, col);
            if (!canAlignCell(currentCell, targetCell)) {
                log.warn(`Tile mismatch at ${row + 1}x${col + 1}`);
                log.data("tile-mismatch", {
                    position: `${row + 1}x${col + 1}`,
                    current: currentCell,
                    target: targetCell
                });
            }
        }
    }

    if (currentBoard.matches(targetBoard)) {
        log.success("Current board already matches target");
        return { solved: true, flag: null, moves: [] };
    }

    const moves = [];

    for (let step = 0; step < puzzleConfig.maxMoves; step += 1) {
        const reasoning = await reasonNextMove({
            currentBoard: currentBoard.toComparable(),
            targetBoard: targetBoard.toComparable(),
            moveHistory: moves.map((move) => move.rotate)
        });

        log.data("main-agent-step", reasoning);

        if (reasoning.status === "solved") {
            log.warn("Main agent believes the board is solved, but no flag has been returned yet");
            break;
        }

        if (reasoning.status === "review" || !reasoning.next_move?.rotate) {
            return {
                solved: false,
                flag: null,
                needs_review: true,
                reason: "main_agent_review",
                details: reasoning,
                moves,
                currentBoard: currentBoard.toComparable(),
                targetBoard: targetBoard.toComparable()
            };
        }

        const rotate = reasoning.next_move.rotate;
        const row = Number(rotate[0]) - 1;
        const col = Number(rotate[2]) - 1;

        log.step(step + 1, puzzleConfig.maxMoves, `Rotating ${rotate}`);
        log.start(`Rotating ${rotate}`);
        const result = await rotateTile(rotate);
        currentBoard.rotate(row, col);
        moves.push({ row, col, rotate, reasoning: reasoning.reasoning });

        log.data("board-after-move", {
            move: rotate,
            board: currentBoard.toComparable()
        });

        if (result.flag) {
            log.success(`Flag returned after ${step + 1} moves`);
            return { solved: true, flag: result.flag, moves };
        }

        if (!result.ok) {
            throw new Error(`Rotate request failed for ${rotate}: ${result.text}`);
        }

        await maybeCheckpoint(step);
    }

    log.warn("Reasoning-first workflow ended without receiving a flag");
    return {
        solved: currentBoard.matches(targetBoard),
        flag: null,
        warning: "Reasoning-first workflow completed without a flag. Target mapping or reasoning output may still be incomplete.",
        finalBoard: currentBoard.toComparable(),
        targetBoard: targetBoard.toComparable(),
        moves
    };
};
