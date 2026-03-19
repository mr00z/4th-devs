const COMPONENT_REGEX = /\b([A-Z]{2,}[A-Z0-9_-]*(?:\d+[A-Z0-9_-]*|[A-Z_-]{2,}))\b/g;

const collectTextHints = (verification) => {
    const hints = [];
    const text = String(verification?.text || '');

    if (text) {
        hints.push(text);
    }

    const json = verification?.json;
    if (json && typeof json === 'object') {
        const candidateFields = [
            json.message,
            json.hint,
            json.error,
            json.reason,
            json.details,
            json?.result?.message,
            json?.response?.message,
        ];

        for (const field of candidateFields) {
            if (typeof field === 'string' && field.trim()) {
                hints.push(field.trim());
            }
        }
    }

    return [...new Set(hints.map((hint) => hint.trim()).filter(Boolean))];
};

const UNKNOWN_INCIDENT_REGEX =
    /do not know what happened to|still do not know what happened to|unable to determine what happened to|cannot determine what happened to|missing|still unclear|unfortunately/i;

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
    'LOGS',
    'DEVICE',
    'TECHNICIANS',
    'THANKS',
]);

const isLikelyComponent = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized || GENERIC_UPPERCASE_WORDS.has(normalized)) {
        return false;
    }

    return /\d/.test(normalized) || /^[A-Z]{4,}$/.test(normalized);
};

const extractQuotedMessage = (hint) => {
    const normalizedHint = String(hint || '');
    const messageFieldMatch = normalizedHint.match(/"message"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);

    if (!messageFieldMatch?.[1]) {
        return normalizedHint;
    }

    return messageFieldMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
};

const collectRequiredComponents = (hints) => {
    const requiredComponents = new Set();

    for (const hint of hints) {
        const normalizedHint = String(hint || '');
        if (!normalizedHint) {
            continue;
        }

        const mentionsUnknownIncident = UNKNOWN_INCIDENT_REGEX.test(normalizedHint);

        if (!mentionsUnknownIncident) {
            continue;
        }

        const sourceText = extractQuotedMessage(normalizedHint);

        for (const match of sourceText.matchAll(COMPONENT_REGEX)) {
            if (isLikelyComponent(match[1])) {
                requiredComponents.add(match[1]);
            }
        }
    }

    return [...requiredComponents];
};

export const extractVerifierDirectives = (verification) => {
    const hints = collectTextHints(verification);
    const requiredComponents = collectRequiredComponents(hints);

    return {
        hints,
        requiredComponents,
    };
};

export const extractVerifierHints = (verification) => {
    const directives = extractVerifierDirectives(verification);
    return directives.hints;
};

export const shouldRetry = ({ verification, attempt, maxAttempts }) => {
    if (verification?.flag) {
        return false;
    }

    return attempt < maxAttempts;
};

