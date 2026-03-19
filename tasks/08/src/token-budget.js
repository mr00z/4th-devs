const estimateTokens = (text) => Math.ceil(text.length / 4);

export const fitEventsWithinBudget = (events, maxTokens) => {
    const selected = [];

    for (const event of events) {
        const candidate = [...selected, event];
        const serialized = candidate.map((item) => item.canonical).join("\\n");
        if (estimateTokens(serialized) <= maxTokens) {
            selected.push(event);
        }
    }

    return {
        selected,
        estimatedTokens: estimateTokens(selected.map((item) => item.canonical).join("\\n")),
        fits: selected.length === events.length
    };
};

export { estimateTokens };
