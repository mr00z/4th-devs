/**
 * Agent loop — chat → tool calls → results cycle until completion.
 * Supports both MCP and native tools with rate limiting.
 */

import { chat, extractToolCalls, extractText } from "./api.js";
import { callMcpTool, mcpToolsToOpenAI } from "./mcp/client.js";
import { nativeTools, isNativeTool, executeNativeTool } from "./native/tools.js";
import log from "./helpers/logger.js";
import { delay, withRetry, defaultRateLimitConfig } from "./helpers/rateLimiter.js";

const MAX_STEPS = 100;

/**
 * Runs a single tool with rate limiting and retry logic
 */
const runTool = async (mcpClient, toolCall, config = {}) => {
  const args = JSON.parse(toolCall.arguments);
  log.tool(toolCall.name, args);

  try {
    log.debug("agent.runTool", `starting ${toolCall.name} (${toolCall.call_id})`);

    const result = await withRetry(async () => {
      return isNativeTool(toolCall.name)
        ? await executeNativeTool(toolCall.name, args)
        : await callMcpTool(mcpClient, toolCall.name, args);
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

/**
 * Runs multiple tools with optional sequential execution and delays
 */
const runTools = async (mcpClient, toolCalls, config = {}) => {
  const { sequentialTools, toolCallDelay } = { ...defaultRateLimitConfig, ...config };

  if (sequentialTools) {
    // Run tools sequentially with delays
    const results = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];

      // Add delay between tool calls (except for the first one)
      if (i > 0 && toolCallDelay > 0) {
        log.debug("agent.runTools", `Waiting ${toolCallDelay}ms before next tool call`);
        await delay(toolCallDelay);
      }

      const result = await runTool(mcpClient, toolCall, config);
      results.push(result);
    }
    return results;
  } else {
    // Run tools in parallel (original behavior)
    return Promise.all(toolCalls.map(tc => runTool(mcpClient, tc, config)));
  }
};

/**
 * Main agent loop with rate limiting support
 */
export const run = async (query, { mcpClient, mcpTools, rateLimitConfig = {} }) => {
  const config = { ...defaultRateLimitConfig, ...rateLimitConfig };
  const tools = [...mcpToolsToOpenAI(mcpTools), ...nativeTools];
  const messages = [{ role: "user", content: query }];

  log.query(query);

  for (let step = 1; step <= MAX_STEPS; step++) {
    log.api(`Step ${step}`, messages.length);

    // Pass rate limit config to chat
    const response = await chat({ input: messages, tools, rateLimitConfig: config });
    log.apiDone(response.usage);

    const toolCalls = extractToolCalls(response);
    log.debug("agent.step", `response items=${response.output?.length ?? 0}, toolCalls=${toolCalls.length}`);

    if (toolCalls.length === 0) {
      const text = extractText(response) ?? "No response";
      return { response: text };
    }

    messages.push(...response.output);

    // Run tools with rate limiting
    const results = await runTools(mcpClient, toolCalls, config);
    messages.push(...results);
  }

  throw new Error(`Max steps (${MAX_STEPS}) reached`);
};
