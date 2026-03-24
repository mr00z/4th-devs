/**
 * Native tools for classifier operations
 * These tools allow the agent to interact with the classifier API
 */

import log from "../helpers/logger.js";
import { setCachedResponse, readCachedData } from "../helpers/cache.js";
import {
    fetchCsvData,
    sendPrompt,
} from "../classifier/api.js";

// In-memory state for tracking classifications
const classificationState = {
    objects: [],
    results: new Map(), // code -> structured result
    attempts: new Map(),
    resetCount: 0
};

const ensureAttemptEntry = (code) => {
    if (!classificationState.attempts.has(code)) {
        classificationState.attempts.set(code, []);
    }

    return classificationState.attempts.get(code);
};

const parseClassifierError = (error) => {
    const statusMatch = error.message.match(/Classifier API error: (\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    const errorCode = error.errorCode ?? error.details?.code ?? null;

    return {
        status,
        errorCode,
        details: error.details ?? null,
        message: error.message,
        needsReset: status === 402 || errorCode === -910,
        rejected: status === 406 || errorCode === -890
    };
};

/**
 * Native tool definitions in OpenAI function format
 */
export const nativeTools = [
    {
        type: "function",
        name: "classifier_fetch_csv",
        description: "Fetch CSV data with railway objects to classify. Returns list of objects with code and description. Call this once at the start and after any reset.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "classifier_send_prompt",
        description: "Send a prompt to the classifier API. Returns classification result or error.",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "Prompt to send to classifier API"
                }
            },
            required: ["prompt"],
            additionalProperties: false
        },
        strict: true
    },
];

/**
 * Native tool handlers
 */
export const nativeHandlers = {
    /**
     * Fetch CSV data
     */
    async classifier_fetch_csv() {
        try {
            log.start("Fetching CSV data...");

            // Check for cached CSV data
            const cached = await readCachedData("csv", {});
            if (cached) {
                log.info("Using cached CSV data");
                classificationState.objects = cached.data.response;
                classificationState.results.clear();
                return {
                    success: true,
                    cached: true,
                    count: classificationState.objects.length,
                    objects: classificationState.objects
                };
            }

            const objects = await fetchCsvData();
            classificationState.objects = objects;

            // Cache the CSV data
            await setCachedResponse("csv", {}, objects);

            log.success(`Loaded ${objects.length} objects from CSV`);

            return {
                success: true,
                cached: false,
                count: objects.length,
                objects: objects
            };
        } catch (error) {
            log.error("CSV fetch failed", error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * Send classification prompt
     */
    async classifier_send_prompt({ prompt }) {
        try {
            // Validate prompt length (rough estimate: 1 token ≈ 0.75 words)
            const estimatedTokens = prompt.split(/\s+/).length * 1.3;
            if (estimatedTokens > 100) {
                log.warn(`Prompt may exceed 100 tokens (estimated: ${Math.round(estimatedTokens)})`);
            }

            log.start("Sending classification prompt...");
            log.debug("classifier", `Prompt: ${prompt}`);

            const result = await sendPrompt(prompt);

            // Check for flag
            if (result.isFlag) {
                log.success(`Secret flag received: ${result.flag}`);
                return {
                    success: true,
                    status: "accepted",
                    is_flag: true,
                    flag: result.flag,
                    response: result.response
                };
            }

            // Check for reset indicator
            if (result.isReset) {
                log.warn("Classifier returned reset message");
                return {
                    success: true,
                    status: "needs_reset",
                    is_reset: true,
                    response: result.response,
                    message: "Classifier context was reset. Please re-fetch CSV and continue."
                };
            }

            // Extract classification from the API response
            const classificationMatch = result.response.match(/(?:Classification|class)[:\s]*(NEU|DNG)/i);
            const proposedClassification = classificationMatch ? classificationMatch[1].toUpperCase() : null;

            log.success(`Classification accepted: ${proposedClassification || "unknown"}`);

            return {
                success: true,
                status: "accepted",
                classification: proposedClassification,
                response: result.response
            };
        } catch (error) {
            const parsed = parseClassifierError(error);

            log.error("Classification failed", error.message);

            if (parsed.needsReset) {
                return {
                    success: false,
                    status: "needs_reset",
                    error: parsed.message,
                    error_code: parsed.errorCode,
                    http_status: parsed.status,
                    details: parsed.details
                };
            }

            if (parsed.rejected) {
                return {
                    success: false,
                    status: "rejected",
                    error: parsed.message,
                    error_code: parsed.errorCode,
                    http_status: parsed.status,
                    details: parsed.details
                };
            }

            return {
                success: false,
                status: "failed",
                error: parsed.message,
                error_code: parsed.errorCode,
                http_status: parsed.status,
                details: parsed.details
            };
        }
    },
};

/**
 * Check if a tool is native
 */
export const isNativeTool = (name) => name in nativeHandlers;

/**
 * Execute a native tool
 */
export const executeNativeTool = async (name, args) => {
    const handler = nativeHandlers[name];
    if (!handler) throw new Error(`Unknown native tool: ${name}`);
    return handler(args);
};

/**
 * Reset the classification state (for testing)
 */
export const resetClassificationState = () => {
    classificationState.objects = [];
    classificationState.results.clear();
    classificationState.resetCount = 0;
};
