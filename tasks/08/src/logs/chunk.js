export const chunkLogEntries = (entries, chunkCount) => {
    const normalizedChunkCount = Math.max(1, Math.min(chunkCount, entries.length || 1));
    const chunkSize = Math.ceil(entries.length / normalizedChunkCount);
    const chunks = [];

    for (let index = 0; index < entries.length; index += chunkSize) {
        const lines = entries.slice(index, index + chunkSize);
        chunks.push({
            id: chunks.length + 1,
            startLine: lines[0]?.id ?? 0,
            endLine: lines.at(-1)?.id ?? 0,
            lines
        });
    }

    return chunks;
};
