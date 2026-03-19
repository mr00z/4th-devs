export const parseFailureLog = (rawLog) => {
    return rawLog
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => ({
            id: index + 1,
            raw: line
        }));
};
