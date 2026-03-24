/**
 * Image Recognition Agent
 */

import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { run } from "./src/agent.js";
import { nativeTools } from "./src/native/tools.js";
import log from "./src/helpers/logger.js";
import { logStats } from "./src/helpers/stats.js";
import { api, rateLimitConfig } from "./src/config.js";

const main = async () => {
  log.box("Image Recognition Agent\nClassify images by character");

  let mcpClient;

  try {
    log.start("Connecting to MCP server...");
    mcpClient = await createMcpClient();
    const mcpTools = await listMcpTools(mcpClient);
    log.success(`MCP: ${mcpTools.map((tool) => tool.name).join(", ")}`);
    log.success(`Native: ${nativeTools.map((tool) => tool.name).join(", ")}`);

    log.start("Starting image classification...");
    log.info(`Rate limiting: ${rateLimitConfig.sequentialTools ? "sequential" : "parallel"} tools, ${rateLimitConfig.apiCallDelay}ms API delay, ${rateLimitConfig.toolCallDelay}ms tool delay`);
    const result = await run(api.instructions, { mcpClient, mcpTools, rateLimitConfig });
    log.success("Classification complete");
    log.info(result.response);

    // Send POST request to verify endpoint
    const verifyEndpoint = process.env.VERIFY_ENDPOINT || "https://hub.ag3nts.org/verify";
    const apiKey = process.env.HUB_API_KEY;

    if (!apiKey) {
      throw new Error("HUB_API_KEY environment variable is not set");
    }

    const response = await fetch(verifyEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: apiKey,
        task: "sendit",
        answer: {
          declaration: result.response
        }
      }),
    });

    const responseData = await response.json();
    if (!response.ok) {
      log.error(`Failed to verify: ${response.status} ${response.statusText}`);
      log.error("Response data:", JSON.stringify(responseData, null, 2));
      throw new Error(`Failed to verify: ${response.status} ${response.statusText}`);
    }

    log.success("Verification response:", JSON.stringify(responseData, null, 2));

    logStats();
  } catch (error) {
    throw error;
  } finally {
    if (mcpClient) {
      await mcpClient.close().catch(() => { });
    }
  }
};

main().catch((error) => {
  log.error("Startup error", error.message);
  process.exit(1);
});
