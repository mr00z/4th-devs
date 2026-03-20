import { stringifyLogs } from '../logs/format.js';
import { estimateTokens } from '../helpers/tokens.js';

const dedupeByLineId = (events) => {
    const byId = new Map();
    for (const event of events) {
        if (!byId.has(event.id)) {
            byId.set(event.id, event);
        }
    }

    return [...byId.values()];
};

/**
 * Normalize message text for dedup comparison:
 * strip prefix artifacts, collapse whitespace, lowercase, take first 60 chars.
 */
const normalizeForDedup = (text) =>
    String(text || '')
        .replace(/^\[?\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*/i, '')
        .replace(/^\[?(?:INFO|WARN|WARNING|ERRO|ERROR|ERR|CRIT|CRITICAL|DEBUG)\]?\s*/i, '')
        .replace(/^[A-Z]{0,5}\]\s*/, '')
        .replace(/^(?:Warning|Error|Critical|Info)\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, 60);

/**
 * Collapse events that have the same component + near-identical message text.
 * Keeps the first and last occurrence, drops the rest.
 */
const dedupeByMessage = (events) => {
    const groups = new Map();

    for (const event of events) {
        const msgKey = `${event.component}::${normalizeForDedup(event.rewrite || event.message)}`;
        if (!groups.has(msgKey)) {
            groups.set(msgKey, []);
        }
        groups.get(msgKey).push(event);
    }

    const result = [];
    for (const group of groups.values()) {
        // Keep first and last (if different) to show timeline span
        result.push(group[0]);
        if (group.length > 1) {
            const last = group[group.length - 1];
            if (last.id !== group[0].id) {
                result.push(last);
            }
        }
    }

    return result.sort((a, b) => a.id - b.id);
};

export const compressEventsToBudget = ({ events, maxTokens, requiredComponents = [] }) => {
    const requiredComponentSet = new Set(requiredComponents);
    let mandatoryEvents = [];
    let optionalEvents = [];

    for (const event of events) {
        if (requiredComponentSet.has(event.component)) {
            mandatoryEvents.push(event);
        } else {
            optionalEvents.push(event);
        }
    }

    mandatoryEvents = dedupeByLineId(mandatoryEvents);
    optionalEvents = dedupeByLineId(optionalEvents);

    // Collapse near-duplicate messages (same component + same text)
    mandatoryEvents = dedupeByMessage(mandatoryEvents);
    optionalEvents = dedupeByMessage(optionalEvents);

    let working = [...mandatoryEvents, ...optionalEvents];

    const readState = () => {
        const logs = stringifyLogs(working);
        return {
            logs,
            estimatedTokens: estimateTokens(logs),
            selectedEvents: working,
        };
    };

    let current = readState();
    if (current.estimatedTokens <= maxTokens) {
        return current;
    }

    // Drop optional events first (lowest-score first)
    while (current.estimatedTokens > maxTokens && optionalEvents.length > 0) {
        optionalEvents.pop();
        working = [...mandatoryEvents, ...optionalEvents];
        current = readState();
    }

    // Drop mandatory events as last resort (lowest-score first)
    while (current.estimatedTokens > maxTokens && mandatoryEvents.length > 1) {
        mandatoryEvents.pop();
        working = [...mandatoryEvents, ...optionalEvents];
        current = readState();
    }

    return current;
};
