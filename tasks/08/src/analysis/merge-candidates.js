const extractHintComponents = (hints) => {
    const joined = hints.join(' ');
    const matches = joined.match(/\b[A-Z]{2,}[A-Z0-9_-]*\d+[A-Z0-9_-]*\b/g);
    return new Set(matches ?? []);
};

const buildCandidate = ({ entry, existingItem = null, scoreBoost = 0, reason = 'selected' }) => ({
    ...entry,
    score: Math.min(1, Math.max(existingItem ? existingItem.score : 0.55, Number(existingItem?.score ?? 0) + scoreBoost)),
    reason: existingItem?.reason ?? reason,
    rewrite: existingItem?.rewrite || entry.message,
});

export const mergeCandidates = ({ analyses, entries, hints, maxEvents, requiredComponents = [] }) => {
    const byLineId = new Map();
    const hintComponents = extractHintComponents(hints);
    const requiredComponentSet = new Set(requiredComponents);

    for (const analysis of analyses) {
        for (const item of analysis.events ?? []) {
            const entry = entries.find((candidate) => candidate.id === item.lineId);
            if (!entry) {
                continue;
            }

            const hintBoost = hintComponents.has(entry.component) ? 0.2 : 0;
            const requiredBoost = requiredComponentSet.has(entry.component) ? 0.25 : 0;

            const candidate = {
                ...entry,
                score: Math.min(1, Math.max(0, Number(item.score ?? 0) + hintBoost + requiredBoost)),
                reason: item.reason ?? 'selected',
                rewrite: item.rewrite || entry.message,
            };

            const existing = byLineId.get(entry.id);
            if (!existing || existing.score < candidate.score) {
                byLineId.set(entry.id, candidate);
            }
        }
    }

    for (const requiredComponent of requiredComponentSet) {
        const matchingEntries = entries
            .filter((entry) => entry.component === requiredComponent)
            .sort((a, b) => {
                const severityRank = { CRIT: 5, ERROR: 4, ERRO: 4, ERR: 4, WARN: 3, INFO: 2, DEBUG: 1 };
                return (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || a.id - b.id;
            })
            .slice(0, 3);

        for (const entry of matchingEntries) {
            const existing = byLineId.get(entry.id);
            byLineId.set(
                entry.id,
                buildCandidate({
                    entry,
                    existingItem: existing,
                    scoreBoost: existing ? 0.1 : 0.35,
                    reason: `required component coverage for ${requiredComponent}`,
                }),
            );
        }
    }

    return [...byLineId.values()]
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .slice(0, Math.max(1, maxEvents));
};

