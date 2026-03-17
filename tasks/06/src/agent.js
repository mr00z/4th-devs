/**
 * Hybrid agent loop.
 * Keeps LLM-driven classification decisions while preserving code-driven recovery.
 */

import { chat, extractToolCalls, extractText } from "./api.js";
import { callMcpTool, mcpToolsToOpenAI } from "./mcp/client.js";
import { nativeTools, isNativeTool, executeNativeTool } from "./native/tools.js";
import log from "./helpers/logger.js";
import { delay, withRetry, defaultRateLimitConfig } from "./helpers/rateLimiter.js";

const MAX_STEPS = 100;

const normalizeToolResult = async (toolName, args, result, config) => {
    if (toolName !== "classifier_send_prompt") {
        return result;
    }

    if (result?.status !== "needs_reset") {
        return result;
    }

    log.warn(`Auto reset triggered for ${args.code} (error_code=${result.error_code})`);
    await executeNativeTool("classifier_fetch_csv", {});

    if (config.apiCallDelay > 0) {
        await delay(config.apiCallDelay);
    }

    const retried = await executeNativeTool(toolName, args);
    return {
        ...retried,
        auto_reset_triggered: true,
        initial_error_code: result.error_code ?? null
    };
};

const runTool = async (mcpClient, toolCall, config = {}) => {
    const args = JSON.parse(toolCall.arguments);
    log.tool(toolCall.name, args);

    try {
        log.debug("agent.runTool", `starting ${toolCall.name} (${toolCall.call_id})`);

        const result = await withRetry(async () => {
            const rawResult = isNativeTool(toolCall.name)
                ? await executeNativeTool(toolCall.name, args)
                : await callMcpTool(mcpClient, toolCall.name, args);

            return normalizeToolResult(toolCall.name, args, rawResult, config);
        }, `tool:${toolCall.name}`, config);

        log.debug("agent.runTool", `finished ${toolCall.name} (${toolCall.call_id})`);

        const output = JSON.stringify(result);
        log.toolResult(toolCall.name, true, output);
        return { type: "function_call_output", call_id: toolCall.call_id, output };
    } catch (error) {
        log.debug("agent.runTool", `failed ${toolCall.name} (${toolCall.call_id})`);
        const output = JSON.stringify({ error: error.message });
        log.toolResult(toolCall.name, false, error.message);
        return { type: "function_call_output", call_id: toolCall.call_id, output };
    }
};

const runTools = async (mcpClient, toolCalls, config = {}) => {
    const { sequentialTools, toolCallDelay } = { ...defaultRateLimitConfig, ...config };

    if (!sequentialTools) {
        return Promise.all(toolCalls.map((toolCall) => runTool(mcpClient, toolCall, config)));
    }

    const results = [];
    for (let index = 0; index < toolCalls.length; index++) {
        if (index > 0 && toolCallDelay > 0) {
            log.debug("agent.runTools", `Waiting ${toolCallDelay}ms before next tool call`);
            await delay(toolCallDelay);
        }

        results.push(await runTool(mcpClient, toolCalls[index], config));
    }

    return results;
};

export const run = async (query, { mcpClient, mcpTools, rateLimitConfig = {} }) => {
    const config = { ...defaultRateLimitConfig, ...rateLimitConfig };
    const tools = [...mcpToolsToOpenAI(mcpTools), ...nativeTools];
    const messages = [{ role: "user", content: query }];

    log.query(query);

    for (let step = 1; step <= MAX_STEPS; step++) {
        log.api(`Step ${step}`, messages.length);

        const response = await chat({
            input: messages,
            tools,
            rateLimitConfig: config
        });

        log.apiDone(response.usage);

        const toolCalls = extractToolCalls(response);
        log.debug("agent.step", `response items=${response.output?.length ?? 0}, toolCalls=${toolCalls.length}`);

        if (toolCalls.length === 0) {
            const text = extractText(response) ?? "No response";
            log.response(text);
            return { response: text };
        }

        messages.push(...response.output);

        const results = await runTools(mcpClient, toolCalls, config);
        messages.push(...results);
    }

    throw new Error(`Max steps (${MAX_STEPS}) reached`);
};

export const runWithState = async (query, options) => run(query, options);
