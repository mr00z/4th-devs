import { failureConfig, hasModelAccess } from './config.js';
import log from './helpers/logger.js';

const parseJsonResponse = async (response) => {
    const text = await response.text();
    try {
        return { text, json: JSON.parse(text) };
    } catch {
        return { text, json: null };
    }
};

export const verifyLogs = async (logs) => {
    const body = {
        apikey: failureConfig.hubApiKey,
        task: failureConfig.task,
        answer: { logs },
    };

    log.trace('verify.request', {
        endpoint: failureConfig.verifyUrl,
        payloadChars: logs.length,
        payloadPreview: logs.slice(0, failureConfig.logPreviewChars),
    });

    const response = await fetch(failureConfig.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const { text, json } = await parseJsonResponse(response);
    const flag = text.match(/\{FLG:[^}]+\}/)?.[0] ?? null;

    log.trace('verify.response', {
        status: response.status,
        ok: response.ok,
        hasFlag: Boolean(flag),
        preview: text.slice(0, failureConfig.logPreviewChars),
    });

    return {
        ok: response.ok,
        status: response.status,
        text,
        json,
        flag,
    };
};

const extractOutputText = (payload) => {
    if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    const parts = [];
    for (const item of payload?.output ?? []) {
        if (!Array.isArray(item?.content)) {
            continue;
        }

        for (const part of item.content) {
            if (typeof part?.text === 'string') {
                parts.push(part.text);
            }
        }
    }

    return parts.join('\n').trim();
};

const maybeParseJson = (text) => {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
};

export const chatJson = async ({ instructions, input, schema, model, maxOutputTokens }) => {
    if (!hasModelAccess) {
        log.trace('chat_json.skipped', 'No model API key configured, using heuristic flow');
        return { outputText: '', outputJson: null, raw: null, skipped: true };
    }

    const body = {
        model: model || failureConfig.model,
        instructions,
        input,
        max_output_tokens: maxOutputTokens ?? failureConfig.maxOutputTokens,
        store: false,
        text: {
            format: {
                type: 'json_schema',
                name: schema.name,
                schema: schema.schema,
                strict: true,
            },
        },
    };

    // log.trace('chat_json.request', {
    //     endpoint: failureConfig.responsesEndpoint,
    //     model: body.model,
    //     schema: schema.name,
    //     inputChars: String(input).length,
    //     maxOutputTokens: body.max_output_tokens,
    // });

    const response = await fetch(failureConfig.responsesEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${failureConfig.aiApiKey}`,
            ...failureConfig.extraHeaders,
        },
        body: JSON.stringify(body),
    });

    const { text, json } = await parseJsonResponse(response);
    if (!response.ok) {
        log.warn(`chat_json error ${response.status}`);
        log.trace('chat_json.error_payload', text.slice(0, failureConfig.logPreviewChars));
        return {
            outputText: text,
            outputJson: null,
            raw: json,
            skipped: false,
            error: `Responses API error ${response.status}`,
        };
    }

    const outputText = extractOutputText(json);
    log.trace('chat_json.response', {
        status: response.status,
        outputChars: outputText.length,
        outputPreview: outputText.slice(0, failureConfig.logPreviewChars),
    });

    return {
        outputText,
        outputJson: maybeParseJson(outputText),
        raw: json,
        skipped: false,
    };
};

