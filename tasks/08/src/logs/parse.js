const LOG_REGEX = /^\[(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{1,2}:\d{2})(?::\d{2})?\]\s*\[(?<severity>[A-Z]+)\]\s*(?<message>.+)$/;

const COMPONENT_REGEX = /\b([A-Z]{2,}[A-Z0-9_-]*(?:\d+[A-Z0-9_-]*|[A-Z_-]{2,}))\b/g;

const GENERIC_UPPERCASE_WORDS = new Set([
    'INFO',
    'WARN',
    'WARNING',
    'ERROR',
    'ERR',
    'ERRO',
    'CRIT',
    'CRITICAL',
    'DEBUG',
    'UNKNOWN',
    'SYSTEM',
    'DEVICE',
    'ALERT',
    'STATUS',
]);

const isLikelyComponent = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized || GENERIC_UPPERCASE_WORDS.has(normalized)) {
        return false;
    }

    return /\d/.test(normalized) || /^[A-Z]{4,}$/.test(normalized);
};

const inferComponent = (message) => {
    for (const match of String(message || '').matchAll(COMPONENT_REGEX)) {
        if (isLikelyComponent(match[1])) {
            return match[1];
        }
    }

    return 'UNKNOWN';
};

export const parseFailureLog = (raw) => {
    const lines = String(raw)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    return lines.map((line, index) => {
        const parsed = line.match(LOG_REGEX);

        if (!parsed?.groups) {
            return {
                id: index + 1,
                timestamp: '',
                date: '',
                time: '',
                severity: 'INFO',
                component: inferComponent(line),
                message: line,
                raw: line,
            };
        }

        const { date, time, severity, message } = parsed.groups;
        return {
            id: index + 1,
            timestamp: `${date} ${time}`,
            date,
            time,
            severity,
            component: inferComponent(message),
            message,
            raw: line,
        };
    });
};

