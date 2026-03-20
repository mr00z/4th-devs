const normalizeTime = (time) => {
    const [h, m] = String(time || '').split(':');
    if (!h || !m) {
        return '00:00';
    }

    const hour = Number(h);
    const minute = Number(m);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
        return '00:00';
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizeDate = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return '1970-01-01';
    }

    return String(date);
};

const stripPrefix = (text) => {
    let s = String(text || '').trim();

    // Strip timestamp (with or without brackets)
    s = s.replace(/^\[?\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*/i, '').trim();

    // Strip severity tag (with or without brackets)
    s = s.replace(/^\[?(?:INFO|WARN|WARNING|ERRO|ERROR|ERR|CRIT|CRITICAL|DEBUG)\]?\s*/i, '').trim();

    // Strip any leftover bracket fragments like "R]", "O]", "ICAL]" etc.
    if (/^[A-Z]{0,5}\]\s*/.test(s)) {
        s = s.replace(/^[A-Z]{0,5}\]\s*/, '').trim();
    }

    // Strip LLM-inserted "Warning:" / "Error:" etc.
    s = s.replace(/^(?:Warning|Error|Critical|Info)\s*:\s*/i, '').trim();

    return s;
};

/**
 * Strip leading component identifier from message text to avoid duplication
 * when the component is already a separate field in the output line.
 * E.g. "STMTURB12 feedback loop exceeded..." → "feedback loop exceeded..."
 *      "STMTURB12: feedback loop..." → "feedback loop..."
 */
const stripLeadingComponent = (message, component) => {
    if (!component || component === 'UNKNOWN') {
        return message;
    }

    const re = new RegExp(`^${component}\\s*:?\\s*`, 'i');
    return message.replace(re, '').trim();
};

export const formatEventLine = (event) => {
    const date = normalizeDate(event.date);
    const time = normalizeTime(event.time);
    const component = String(event.component || 'UNKNOWN').toUpperCase();
    const rawMessage = String(event.rewrite || event.message || '');
    let message = stripPrefix(rawMessage).replace(/\s+/g, ' ').trim();
    message = stripLeadingComponent(message, component);

    return `${date} ${time} ${component} ${message}`.trim();
};

export const stringifyLogs = (events) => events.map(formatEventLine).join('\n');
