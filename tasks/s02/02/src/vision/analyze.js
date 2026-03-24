import { readFile } from "node:fs/promises";
import { puzzleConfig } from "../config.js";
import { normalizeBoardSchema } from "./schema.js";
import { AI_API_KEY, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT } from "../../../../config.js";
import log from "../helpers/logger.js";
import { cropPng } from "./crop.js";

let liveVisionCache = null;

const boardSchema = {
    name: "electricity_board",
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["cells"],
        properties: {
            cells: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["type", "openings", "rotation", "confidence"],
                        properties: {
                            type: {
                                type: "string",
                                enum: ["elbow", "straight", "tee", "empty", "cap", "unknown"]
                            },
                            openings: {
                                type: "array",
                                items: {
                                    type: "string",
                                    enum: ["N", "E", "S", "W"]
                                }
                            },
                            rotation: {
                                type: "integer",
                                minimum: 0,
                                maximum: 3
                            },
                            confidence: {
                                type: "number",
                                minimum: 0,
                                maximum: 1
                            }
                        }
                    }
                }
            }
        }
    }
};

const VISION_SYSTEM_PROMPT = [
    "You are a precise vision sub-agent for a 3x3 rotation puzzle.",
    "Your only task is to identify the pipe shape inside each of the 9 grid cells.",
    "Ignore all decorative text, labels, icons, background texture, and anything outside the main 3x3 grid.",
    "Treat each cell independently, but use neighboring cells only to understand whether a black line truly exits a cell edge.",
    "For each cell, determine the canonical tile type and the sides where the black path exits the cell boundary: N, E, S, W.",
    "Allowed tile types are: elbow, straight, tee, empty, cap, unknown.",
    "Use 'straight' for exactly two opposite openings.",
    "Use 'elbow' for exactly two adjacent openings.",
    "Use 'tee' for exactly three openings.",
    "Use 'cap' for exactly one opening.",
    "Use 'empty' only when there is no black path segment in the cell.",
    "If the image is ambiguous, prefer the openings that are visibly crossing the cell border, and lower confidence instead of inventing geometry.",
    "Do not describe connectivity in prose. Return only the schema-conformant structured result."
].join(" ");

const buildInputImage = async (imagePath) => {
    const file = await readFile(imagePath);
    return {
        type: "input_image",
        image_url: `data:image/png;base64,${file.toString("base64")}`
    };
};

const extractStructuredJson = (response) => {
    for (const item of response.output ?? []) {
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

    throw new Error("Vision response did not include structured JSON payload");
};

export const analyzeBoardImage = async ({ imagePath, label }) => {
    if (label === "current" && liveVisionCache?.imagePath === imagePath) {
        log.data("vision-cache-hit-current", {
            imagePath,
            croppedPath: liveVisionCache.croppedPath
        });
        return liveVisionCache.cells.map((row) => row.map((cell) => ({
            ...cell,
            openings: [...cell.openings]
        })));
    }

    const croppedPath = label === "target"
        ? puzzleConfig.croppedTargetImagePath
        : puzzleConfig.croppedLiveImagePath;

    const cropped = await cropPng({
        inputPath: imagePath,
        outputPath: croppedPath,
        crop: puzzleConfig.crop
    });

    log.data(`vision-crop-${label}`, cropped);

    log.debug("vision.analyze.request", {
        label,
        imagePath: croppedPath,
        model: puzzleConfig.visionModel,
        endpoint: RESPONSES_API_ENDPOINT
    });

    const response = await fetch(RESPONSES_API_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AI_API_KEY}`,
            ...EXTRA_API_HEADERS
        },
        body: JSON.stringify({
            model: puzzleConfig.visionModel,
            instructions: VISION_SYSTEM_PROMPT,
            text: {
                format: {
                    type: "json_schema",
                    name: boardSchema.name,
                    schema: boardSchema.schema,
                    strict: true
                }
            },
            input: [{
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: `Analyze the cropped 3x3 electricity puzzle image labeled ${label}. The crop contains only the puzzle grid. Read the 9 cells row by row. For each cell, return the tile type, the openings visible at the cell borders, a rotation from 0 to 3 if inferable, and a confidence score. Use the provided schema only.`
                    },
                    await buildInputImage(croppedPath)
                ]
            }],
            max_output_tokens: 800
        })
    });

    const data = await response.json();
    log.data(`vision-response-${label}`, {
        status: response.status,
        ok: response.ok,
        outputPreview: JSON.stringify(data?.output ?? data).slice(0, 4000)
    });

    if (!response.ok || data.error) {
        throw new Error(data?.error?.message || `Vision request failed (${response.status})`);
    }

    const normalized = normalizeBoardSchema(extractStructuredJson(data));
    log.data(`vision-normalized-${label}`, normalized);

    if (label === "current") {
        liveVisionCache = {
            imagePath,
            croppedPath,
            cells: normalized.map((row) => row.map((cell) => ({
                ...cell,
                openings: [...cell.openings]
            })))
        };
        log.data("vision-cache-store-current", {
            imagePath,
            croppedPath
        });
    }

    return normalized;
};
