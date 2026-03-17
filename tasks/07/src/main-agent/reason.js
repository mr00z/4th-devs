import { AI_API_KEY, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT } from "../../../../config.js";
import { puzzleConfig } from "../config.js";
import log from "../helpers/logger.js";
import { MAIN_AGENT_PROMPT } from "../agent.js";

const moveSchema = {
    name: "electricity_next_move",
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["status", "reasoning", "next_move"],
        properties: {
            status: {
                type: "string",
                enum: ["move", "solved", "review"]
            },
            reasoning: {
                type: "string"
            },
            next_move: {
                anyOf: [
                    {
                        type: "object",
                        additionalProperties: false,
                        required: ["rotate"],
                        properties: {
                            rotate: {
                                type: "string",
                                pattern: "^[1-3]x[1-3]$"
                            }
                        }
                    },
                    {
                        type: "null"
                    }
                ]
            }
        }
    }
};

const extractStructuredJson = (response) => {
    for (const item of response.output ?? []) {
        if (item.type === "reasoning") {
            continue;
        }

        if (item.type === "output_text" && item.text) {
            return JSON.parse(item.text);
        }

        if (item.type === "message") {
            for (const content of item.content ?? []) {
                if (content.type === "output_text" && content.text) {
                    return JSON.parse(content.text);
                }
            }
        }
    }

    throw new Error("Main agent response did not include structured JSON payload");
};

const tryParseJson = (text) => {
    if (typeof text !== "string") {
        return null;
    }

    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
};

const findJsonObjectBounds = (text) => {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === "\\") {
                escaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === "{") {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
            continue;
        }

        if (char === "}") {
            if (depth === 0) {
                continue;
            }

            depth -= 1;
            if (depth === 0 && start !== -1) {
                return [start, index + 1];
            }
        }
    }

    return null;
};

const extractJsonCandidate = (text) => {
    const direct = tryParseJson(text);
    if (direct) {
        return direct;
    }

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
        const fenced = tryParseJson(fencedMatch[1]);
        if (fenced) {
            return fenced;
        }
    }

    const bounds = findJsonObjectBounds(text);
    if (bounds) {
        const [start, end] = bounds;
        return tryParseJson(text.slice(start, end));
    }

    return null;
};

const isValidReasoningPayload = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const validStatus = typeof value.status === "string"
        && ["move", "solved", "review"].includes(value.status);
    const validReasoning = typeof value.reasoning === "string";
    const validNextMove = value.next_move === null
        || (typeof value.next_move === "object"
            && !Array.isArray(value.next_move)
            && typeof value.next_move.rotate === "string"
            && /^[1-3]x[1-3]$/.test(value.next_move.rotate));

    return validStatus && validReasoning && validNextMove;
};

const extractResponsePayload = (response) => {
    for (const item of response.output ?? []) {
        if (item.type === "output_text" && item.text) {
            const candidate = extractJsonCandidate(item.text);
            if (isValidReasoningPayload(candidate)) {
                return candidate;
            }
        }

        if (item.type === "message") {
            for (const content of item.content ?? []) {
                if (content.type === "output_text" && content.text) {
                    const candidate = extractJsonCandidate(content.text);
                    if (isValidReasoningPayload(candidate)) {
                        return candidate;
                    }
                }
            }
        }
    }

    return null;
};

const extractReasoningText = (response) => {
    const parts = [];

    for (const item of response.output ?? []) {
        if (item.type === "reasoning") {
            for (const summary of item.summary ?? []) {
                if (typeof summary?.text === "string" && summary.text.trim()) {
                    parts.push(summary.text.trim());
                }
            }
        }

        if (item.type === "message") {
            for (const content of item.content ?? []) {
                if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
                    parts.push(content.text.trim());
                }
            }
        }
    }

    return parts.join("\n").trim() || null;
};

const inferMoveFromBoards = (currentBoard, targetBoard) => {
    const rotateOpeningsClockwise = (openings) => {
        const map = { N: "E", E: "S", S: "W", W: "N" };
        return openings.map((side) => map[side]).sort();
    };

    const normalize = (cell) => [...cell].sort().join("");

    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            const current = currentBoard[row][col].split("").filter(Boolean);
            const target = targetBoard[row][col].split("").filter(Boolean);
            if (normalize(current) === normalize(target)) {
                continue;
            }

            let probe = [...current];
            for (let turn = 1; turn <= 3; turn += 1) {
                probe = rotateOpeningsClockwise(probe);
                if (normalize(probe) === normalize(target)) {
                    return `${row + 1}x${col + 1}`;
                }
            }
        }
    }

    return null;
};

export const reasonNextMove = async ({ currentBoard, targetBoard, moveHistory }) => {
    log.debug("main-agent.reason.request", {
        model: puzzleConfig.mainModel,
        currentBoard,
        targetBoard,
        moveHistory
    });

    const response = await fetch(RESPONSES_API_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AI_API_KEY}`,
            ...EXTRA_API_HEADERS
        },
        body: JSON.stringify({
            model: puzzleConfig.mainModel,
            instructions: MAIN_AGENT_PROMPT,
            reasoning: {
                effort: "medium"
            },
            text: {
                format: {
                    type: "json_schema",
                    name: moveSchema.name,
                    schema: moveSchema.schema,
                    strict: true
                }
            },
            input: [{
                role: "user",
                content: [{
                    type: "input_text",
                    text: `Current board: ${JSON.stringify(currentBoard)}\nTarget board: ${JSON.stringify(targetBoard)}\nMove history: ${JSON.stringify(moveHistory)}\nChoose exactly one next clockwise rotation if needed. If the board is already solved, return status solved. If the board data seems inconsistent or insufficient, return status review.`
                }]
            }],
            max_output_tokens: 400
        })
    });

    const data = await response.json();
    log.data("main-agent.reason.response", {
        status: response.status,
        ok: response.ok,
        preview: JSON.stringify(data?.output ?? data).slice(0, 2000)
    });

    if (!response.ok || data.error) {
        throw new Error(data?.error?.message || `Main agent reasoning request failed (${response.status})`);
    }

    const parsed = extractResponsePayload(data);

    if (!parsed) {
        const fallbackRotate = inferMoveFromBoards(currentBoard, targetBoard);
        const fallbackReasoning = extractReasoningText(data) ?? "Main agent returned reasoning without structured output.";

        if (fallbackRotate) {
            const fallback = {
                status: "move",
                reasoning: fallbackReasoning,
                next_move: { rotate: fallbackRotate }
            };
            log.data("main-agent.reason.fallback", fallback);
            return fallback;
        }

        return {
            status: "review",
            reasoning: fallbackReasoning,
            next_move: null
        };
    }

    log.data("main-agent.reason.parsed", parsed);
    return parsed;
};
