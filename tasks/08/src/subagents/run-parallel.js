import log from "../helpers/logger.js";
import { analyzeChunk } from "./analyze-chunk.js";

export const runParallelSubagents = async ({ chunks, attempt, verifierHints }) => {
    await log.data("subagents_started", {
        attempt,
        chunkCount: chunks.length
    });

    return Promise.all(chunks.map((chunk) => analyzeChunk({
        chunk,
        attempt,
        totalChunks: chunks.length,
        verifierHints
    })));
};
