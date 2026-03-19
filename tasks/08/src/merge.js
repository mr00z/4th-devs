const severityRank = {
    CRIT: 5,
    ERROR: 4,
    WARN: 3,
    INFO: 2,
    DEBUG: 1
};

const createKey = (event) => `${event.timestamp}|${event.severity}|${event.component}|${event.summary}`.toLowerCase();

export const mergeCandidates = (results) => {
    const map = new Map();

    for (const result of results) {
        for (const event of result.events || []) {
            const key = createKey(event);
            const previous = map.get(key);

            if (!previous || (event.score ?? 0) > (previous.score ?? 0)) {
                map.set(key, event);
            }
        }
    }

    return [...map.values()].sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
            return left.timestamp.localeCompare(right.timestamp);
        }

        return (severityRank[right.severity] ?? 0) - (severityRank[left.severity] ?? 0);
    });
};

export const rankCandidates = (events, verifierHints = []) => {
    const hints = verifierHints.map((hint) => hint.toLowerCase());

    return [...events].sort((left, right) => {
        const leftHintBoost = hints.some((hint) => left.canonical.toLowerCase().includes(hint) || left.reason.toLowerCase().includes(hint)) ? 2 : 0;
        const rightHintBoost = hints.some((hint) => right.canonical.toLowerCase().includes(hint) || right.reason.toLowerCase().includes(hint)) ? 2 : 0;

        const leftScore = (left.score ?? 0) + leftHintBoost + (severityRank[left.severity] ?? 0);
        const rightScore = (right.score ?? 0) + rightHintBoost + (severityRank[right.severity] ?? 0);

        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }

        return left.timestamp.localeCompare(right.timestamp);
    });
};

export const stringifyLogs = (events) => events.map((event) => event.canonical).join("\\n");

export const expandCandidateContext = (events) => {
    const byComponent = new Map();

    for (const event of events) {
        const key = event.component.toLowerCase();
        if (!byComponent.has(key)) {
            byComponent.set(key, []);
        }

        byComponent.get(key).push(event);
    }

    const expanded = [];
    const seen = new Set();

    for (const event of events) {
        const componentEvents = byComponent.get(event.component.toLowerCase()) ?? [];
        const neighborhood = componentEvents
            .filter((candidate) => Math.abs(new Date(candidate.timestamp).getTime() - new Date(event.timestamp).getTime()) <= 6 * 60 * 60 * 1000)
            .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

        for (const candidate of neighborhood.length > 0 ? neighborhood : [event]) {
            const key = `${candidate.timestamp}|${candidate.severity}|${candidate.component}|${candidate.summary}`.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                expanded.push(candidate);
            }
        }
    }

    return expanded.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
};
