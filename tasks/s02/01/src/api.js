/**
 * AI API client for chat completions.
 */

import { api } from "./config.js";
import {
    AI_API_KEY,
    EXTRA_API_HEADERS,
    RESPONSES_API_ENDPOINT
} from "../../../../config.js";
import { extractResponseText } from "./helpers/response.js";
import { recordUsage } from "./helpers/stats.js";
import { withRetry, enforceMinDelay, defaultRateLimitConfig } from "./helpers/rateLimiter.js";

// Track last API call time for rate limiting
let lastApiCallTime = 0;

/**
 * Calls the Responses API with retry logic and rate limiting.
 */
export const chat = async ({ model = api.model, input, tools, toolChoice = "auto", instructions = api.instructions, maxOutputTokens = api.maxOutputTokens, rateLimitConfig = {} }) => {
    const config = { ...defaultRateLimitConfig, ...rateLimitConfig };

    // Enforce minimum delay between API calls
    lastApiCallTime = await enforceMinDelay(lastApiCallTime, config.apiCallDelay);

    const body = { model, input };

    if (tools?.length) body.tools = tools;
    if (tools?.length) body.tool_choice = toolChoice;
    if (instructions) body.instructions = instructions;
    if (maxOutputTokens) body.max_output_tokens = maxOutputTokens;

    // Use retry logic for the API call
    const data = await withRetry(async () => {
        const response = await fetch(RESPONSES_API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${AI_API_KEY}`,
                ...EXTRA_API_HEADERS
            },
            body: JSON.stringify(body)
        });

        const responseData = await response.json();

        if (!response.ok || responseData.error) {
            throw new Error(responseData?.error?.message || `Responses API request failed (${response.status})`);
        }

        return responseData;
    }, "chat API", config);

    recordUsage(data.usage);

    return data;
};

/**
 * Extracts function calls from response.
 */
export const extractToolCalls = (response) =>
    (response.output ?? []).filter((item) => item.type === "function_call");

/**
 * Extracts text content from response.
 */
export const extractText = (response) => {
    return extractResponseText(response) || null;
};
