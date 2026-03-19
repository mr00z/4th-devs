export const extractVerifierHints = (verification) => {
    const sources = [
        verification.text,
        typeof verification.json?.message === "string" ? verification.json.message : null,
        typeof verification.json?.hint === "string" ? verification.json.hint : null,
        Array.isArray(verification.json?.hints) ? verification.json.hints.join(" ") : null
    ].filter(Boolean);

    const text = sources.join(" ");
    if (!text) {
        return [];
    }

    return [...new Set(
        text
            .split(/[.!?\n]/)
            .map((part) => part.trim())
            .filter((part) => part.length >= 4)
    )].slice(0, 8);
};

export const shouldRetry = (verification, attempt, maxAttempts) => {
    if (verification.flag) {
        return false;
    }

    return attempt < maxAttempts;
};
