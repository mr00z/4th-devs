import { chatJson } from '../api.js';
import { failureConfig, hasModelAccess } from '../config.js';
import { CHUNK_ANALYSIS_INSTRUCTIONS, CHUNK_ANALYSIS_SCHEMA } from './prompts.js';

const severityScore = {
    CRIT: 1.0,
    ERROR: 0.92,
    ERRO: 0.92,
    ERR: 0.9,
    WARN: 0.78,
    INFO: 0.45,
    DEBUG: 0.2,
};

const keywordBoosts = [
    { re: /trip|hard trip|reactor trip|interlock/i, score: 0.25 },
    { re: /runaway|overheat|temp|temperature/i, score: 0.2 },
    { re: /coolant|leak|pressure|pump|flow/i, score: 0.18 },
    { re: /input ripple|voltage|power|grid|phase/i, score: 0.16 },
    { re: /critical|threshold|protection/i, score: 0.14 },
    { re: /fault|alarm|anomaly|unstable/i, score: 0.12 },
];

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const heuristicScore = (event) => {
    let score = severityScore[event.severity] ?? 0.35;
    for (const { re, score: boost } of keywordBoosts) {
        if (re.test(event.message)) {
            score += boost;
        }
    }

    if (event.component === 'UNKNOWN') {
        score -= 0.08;
    }

    return clamp01(score);
};

const compactRewrite = (event) => {
    let clean = String(event.message || '').replace(/\s+/g, ' ').trim();
    // Strip leading component name if present (it's a separate field)
    if (event.component && event.component !== 'UNKNOWN') {
        const re = new RegExp(`^${event.component}\\s*:?\\s*`, 'i');
        clean = clean.replace(re, '').trim();
    }
    return clean;
};

const heuristicAnalyze = (chunk, hints) => {
    const hintText = hints.join(' ').toLowerCase();
    const targetShortage = /too short|add more|missing/i.test(hintText);
    const hintedComponents = new Set(
        hints
            .join(' ')
            .match(/\b[A-Z]{2,}[A-Z0-9_-]*\d+[A-Z0-9_-]*\b/g) ?? [],
    );

    const ranked = chunk.lines
        .map((event) => ({
            lineId: event.id,
            score: clamp01(heuristicScore(event) + (hintedComponents.has(event.component) ? 0.3 : 0)),
            reason: hintedComponents.has(event.component)
                ? 'heuristic ranking (severity + anomaly keywords + verifier-requested component)'
                : 'heuristic ranking (severity + anomaly keywords)',
            rewrite: compactRewrite(event),
        }))
        .sort((a, b) => b.score - a.score);

    const limit = targetShortage ? 32 : 20;
    return { events: ranked.slice(0, limit) };
};

export const analyzeChunk = async ({ chunk, hints = [], requiredComponents = [] }) => {
    if (!hasModelAccess) {
        return heuristicAnalyze(chunk, hints);
    }

    const payload = {
        chunk: {
            id: chunk.id,
            startLine: chunk.startLineId,
            endLine: chunk.endLineId,
            lines: chunk.lines.map((line) => ({
                lineId: line.id,
                raw: line.raw,
                date: line.date,
                time: line.time,
                severity: line.severity,
                component: line.component,
            })),
        },
        verifierHints: hints,
        requiredComponents,
    };

    const completion = await chatJson({
        instructions: CHUNK_ANALYSIS_INSTRUCTIONS,
        input: JSON.stringify(payload),
        schema: CHUNK_ANALYSIS_SCHEMA,
        model: failureConfig.model,
    });

    const response = completion.outputJson;
    if (!response || !Array.isArray(response.events)) {
        return heuristicAnalyze(chunk, hints);
    }

    return {
        events: response.events
            .filter((item) => Number.isInteger(item.lineId))
            .map((item) => ({
                lineId: item.lineId,
                score: clamp01(Number(item.score) || 0),
                reason: String(item.reason || '').slice(0, 300),
                rewrite: String(item.rewrite || '').trim(),
            })),
    };
};

