import { AI_API_KEY, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT } from "../../../config.js";
import { failureConfig } from "./config.js";
import log from "./helpers/logger.js";

const extractOutputText = (payload) => {
    if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
        return payload.output_text;
    }

    const parts = [];
    for (const item of payload?.output ?? []) {
        if (!Array.isArray(item?.content)) {
            continue;
        }

        for (const part of item.content) {
            if (typeof part?.text === "string") {
                parts.push(part.text);
            }
        }
    }

    if (parts.length > 0) {
        return parts.join("\n").trim();
    }

    // For incomplete responses, try to extract partial text from response.output
    for (const item of payload?.response?.output ?? payload?.output ?? []) {
        if (!Array.isArray(item?.content)) {
            continue;
        }

        for (const part of item.content) {
            if (typeof part?.text === "string") {
                parts.push(part.text);
            }
        }
    }

    return parts.join("\n").trim();
};

const maybeParseJsonFragment = (text) => {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) {
            return null;
        }

        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch {
            return null;
        }
    }
};

const trimToLastBalancedJsonObject = (text) => {
    const start = text.indexOf("{");
    if (start === -1) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let lastBalancedIndex = -1;

    for (let index = start; index < text.length; index += 1) {
        const char = text[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === "\\") {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                lastBalancedIndex = index;
            }
        }
    }

    if (lastBalancedIndex === -1) {
        return null;
    }

    return text.slice(start, lastBalancedIndex + 1);
};

const repairStructuredChunkOutput = (text) => {
    if (!text.includes('{"events":[')) {
        return null;
    }

    const head = text.slice(0, text.lastIndexOf("{"));
    const closingArrayIndex = head.lastIndexOf("},");
    if (closingArrayIndex === -1) {
        return null;
    }

    const repaired = `${head.slice(0, closingArrayIndex + 1)}]}`;
    try {
        return JSON.parse(repaired);
    } catch {
        return null;
    }
};

const parseJsonResponse = async (response) => {
    const text = await response.text();
    try {
        return { text, json: JSON.parse(text) };
    } catch {
        return { text, json: null };
    }
};

const extractIncompleteReason = (json) => {
    const candidates = [
        json?.incomplete_details?.reason,
        json?.response?.incomplete_details?.reason,
        json?.error?.message
    ].filter((value) => typeof value === "string" && value.trim());

    return candidates[0] || null;
};

export const fetchFailureLog = async () => {
    await log.api("failure_log_fetch.request", { url: failureConfig.dataUrl });
    const response = await fetch(failureConfig.dataUrl);
    const text = await response.text();

    await log.api("failure_log_fetch.response", {
        ok: response.ok,
        status: response.status,
        preview: text.slice(0, 200)
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch failure log (${response.status})`);
    }

    return text;
};

export const verifyLogs = async (logs) => {
    const body = {
        apikey: failureConfig.apiKey,
        task: failureConfig.task,
        answer: { logs }
    };

    await log.api("verify.request", {
        endpoint: failureConfig.verifyUrl,
        logsPreview: logs.slice(0, 200),
        bodyShape: { task: body.task, hasLogs: true }
    });

    const response = await fetch(failureConfig.verifyUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const { text, json } = await parseJsonResponse(response);
    const flag = text.match(/\{FLG:[^}]+\}/)?.[0] ?? null;

    await log.api("verify.response", {
        ok: response.ok,
        status: response.status,
        hasFlag: Boolean(flag),
        preview: text.slice(0, 300)
    });

    return {
        ok: response.ok,
        status: response.status,
        text,
        json,
        flag
    };
};

export const chatJson = async ({ model, instructions, input, maxOutputTokens = failureConfig.maxOutputTokens }) => {
    const body = {
        model,
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        store: false,
        text: {
            format: {
                type: "json_schema",
                name: "failure_chunk_analysis",
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        events: {
                            type: "array",
                            items: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                    timestamp: { type: "string" },
                                    severity: { type: "string" },
                                    component: { type: "string" },
                                    summary: { type: "string" }
                                },
                                required: ["timestamp", "severity", "component", "summary"]
                            }
                        }
                    },
                    required: ["events"]
                }
            }
        }
    };

    await log.api("llm.request", {
        model,
        inputItems: input.length,
        instructionsPreview: instructions.slice(0, 160)
    });

    const response = await fetch(RESPONSES_API_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AI_API_KEY}`,
            ...EXTRA_API_HEADERS
        },
        body: JSON.stringify(body)
    });

    const { text, json } = await parseJsonResponse(response);
    await log.api("llm.response", {
        ok: response.ok,
        status: response.status,
        preview: text.slice(0, 240)
    });

    if (!response.ok) {
        throw new Error(json?.error?.message || `LLM request failed (${response.status})`);
    }

    const outputText = extractOutputText(json) || text;
    const parsed = maybeParseJsonFragment(outputText)
        || maybeParseJsonFragment(trimToLastBalancedJsonObject(outputText) || "")
        || repairStructuredChunkOutput(outputText);

    if (json?.status && json.status !== "completed") {
        await log.api("llm.incomplete_details", {
            status: json.status,
            incompleteReason: extractIncompleteReason(json),
            outputTextPreview: outputText.slice(0, 500),
            parsedEvents: parsed?.events?.length ?? "no-parse"
        });
    }

    if (json?.status && json.status !== "completed" && !parsed) {
        const incompleteReason = extractIncompleteReason(json);
        const tokenLimited = incompleteReason === "max_output_tokens";
        const guidance = tokenLimited
            ? ` Increase [failureConfig.maxOutputTokens](tasks/08/src/config.js:69) or reduce prompt/input size.`
            : "";
        throw new Error(`Structured output incomplete: status=${json.status}${incompleteReason ? `; reason=${incompleteReason}` : ""}. Preview: ${text.slice(0, 240)}${guidance}`);
    }

    if (!parsed) {
        throw new Error(`Structured output parse failed. Preview: ${outputText.slice(0, 240)}`);
    }

    return parsed;
};
