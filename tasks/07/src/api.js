import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { puzzleConfig } from "./config.js";
import log from "./helpers/logger.js";

export const fetchPuzzleImage = async () => {
    log.debug("api.fetchPuzzleImage", { url: puzzleConfig.dataUrl });
    const response = await fetch(puzzleConfig.dataUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch puzzle image (${response.status})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(path.dirname(puzzleConfig.liveImagePath), { recursive: true });
    await writeFile(puzzleConfig.liveImagePath, buffer);
    log.data("live-image", { path: puzzleConfig.liveImagePath, bytes: buffer.length });
    return { path: puzzleConfig.liveImagePath, bytes: buffer.length };
};

export const rotateTile = async (rotate) => {
    log.debug("api.rotateTile.request", { rotate, endpoint: puzzleConfig.verifyUrl });
    const response = await fetch(puzzleConfig.verifyUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            apikey: puzzleConfig.apiKey,
            task: puzzleConfig.task,
            answer: { rotate }
        })
    });

    const text = await response.text();
    const flagMatch = text.match(/\{FLG:[^}]+\}/);
    log.data("rotate-response", {
        rotate,
        ok: response.ok,
        status: response.status,
        hasFlag: Boolean(flagMatch),
        preview: text.slice(0, 300)
    });

    return {
        ok: response.ok,
        status: response.status,
        text,
        flag: flagMatch?.[0] ?? null
    };
};
