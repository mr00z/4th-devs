import { chatJson } from "../api.js";
import { failureConfig } from "../config.js";
import log from "../helpers/logger.js";
import { createChunkAnalysisPrompt } from "../prompts.js";

const sanitizeEvent = (event, chunk) => {
    const timestamp = String(event?.timestamp || "").trim();
    const severity = String(event?.severity || "").trim().toUpperCase();
    const component = String(event?.component || "").trim();
    const summary = String(event?.summary || "").trim();

    if (!timestamp || !severity || !component || !summary) {
        return null;
    }

    const canonical = `${timestamp} [${severity}] ${component} ${summary}`.trim();
    const score = (severity === "CRIT" ? 5 : severity === "ERROR" ? 4 : severity === "WARN" ? 3 : 1)
        + (/trip|runaway|coolant|interlock|pressure|voltage|tank|pump|thermal|reactor|decoupling|instability|drift|anomaly|protection|bypass|alarm/i.test(summary) ? 2 : 0);
    const reason = `severity=${severity}; component=${component}`;

    return {
        timestamp,
        severity,
        component,
        summary,
        canonical,
        score: Number.isFinite(score) ? score : 0,
        reason,
        chunkId: chunk.id,
        sourceStart: chunk.startLine,
        sourceEnd: chunk.endLine
    };
};

export const analyzeChunk = async ({ chunk, attempt, totalChunks, verifierHints }) => {
    await log.start(`subagent chunk=${chunk.id} lines=${chunk.startLine}-${chunk.endLine}`);
    const instructions = createChunkAnalysisPrompt({
        attempt,
        totalChunks,
        verifierHints,
        maxEvents: failureConfig.subagentMaxEvents
    });
    const input = [{
        role: "user",
        content: [
            `Analyze log lines ${chunk.startLine}-${chunk.endLine}. Return JSON only.`,
            `JSON shape: {"events":[{"timestamp":"YYYY-MM-DD HH:MM","severity":"CRIT|ERROR|WARN|INFO","component":"...","summary":"..."}]}`,
            `Return up to ${failureConfig.subagentMaxEvents} failure-relevant events from this chunk.`,
            "",
            chunk.lines.map((entry) => entry.raw).join("\n")
        ].join("\n")
    }];

    try {
        const response = await chatJson({
            model: failureConfig.subagentModel,
            instructions,
            input
        });

        const events = Array.isArray(response?.events)
            ? response.events.map((event) => sanitizeEvent(event, chunk)).filter(Boolean)
            : [];

        await log.data("subagent_completed", {
            chunkId: chunk.id,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            candidateCount: events.length
        });

        return {
            chunkId: chunk.id,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            events
        };
    } catch (error) {
        await log.error(`subagent_failed chunk=${chunk.id}`, error.message);
        return {
            chunkId: chunk.id,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            events: [],
            error: error.message
        };
    }
};
