export const estimateTokens = (text) => {
    if (!text) {
        return 0;
    }

    const normalized = String(text);
    // Use ~2.5 chars/token for structured log text with technical terms.
    // The previous 4 chars/token was too optimistic and caused budget overruns.
    return Math.ceil(normalized.length / 2.5);
};

export const fitsTokenBudget = (text, maxTokens) => estimateTokens(text) <= maxTokens;

