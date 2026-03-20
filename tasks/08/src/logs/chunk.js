export const chunkByLines = (entries, size, overlap) => {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }

    const chunkSize = Math.max(1, size);
    const chunkOverlap = Math.max(0, Math.min(overlap, chunkSize - 1));
    const step = Math.max(1, chunkSize - chunkOverlap);
    const chunks = [];

    let start = 0;
    while (start < entries.length) {
        const endExclusive = Math.min(entries.length, start + chunkSize);
        const lines = entries.slice(start, endExclusive);

        chunks.push({
            id: chunks.length + 1,
            startIndex: start,
            endIndex: endExclusive - 1,
            startLineId: lines[0]?.id ?? 0,
            endLineId: lines.at(-1)?.id ?? 0,
            overlap: chunkOverlap,
            lines,
        });

        if (endExclusive >= entries.length) {
            break;
        }
        start += step;
    }

    return chunks;
};

