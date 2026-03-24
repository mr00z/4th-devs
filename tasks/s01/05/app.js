/**
 * Railway Route Activation Agent
 * Activates railway route X-01 through the hub.ag3nts.org API
 */

import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { run } from "./src/agent.js";
import { nativeTools } from "./src/native/tools.js";
import log from "./src/helpers/logger.js";
import { logStats } from "./src/helpers/stats.js";
import { api, rateLimitConfig, railwayConfig } from "./src/config.js";

const main = async () => {
    log.box("Railway Route Activation Agent\nActivate route X-01");

    // Validate API key
    if (!railwayConfig.apiKey) {
        log.error("HUB_API_KEY environment variable is not set");
        process.exit(1);
    }

    let mcpClient;

    try {
        log.start("Connecting to MCP server...");
        mcpClient = await createMcpClient();
        const mcpTools = await listMcpTools(mcpClient);
        log.success(`MCP: ${mcpTools.map((tool) => tool.name).join(", ")}`);
        log.success(`Native: ${nativeTools.map((tool) => tool.name).join(", ")}`);

        log.start("Starting route activation...");
        log.info(`Rate limiting: ${rateLimitConfig.sequentialTools ? "sequential" : "parallel"} tools, ${rateLimitConfig.apiCallDelay}ms API delay, ${rateLimitConfig.toolCallDelay}ms tool delay`);
        log.info(`Target route: ${railwayConfig.targetRoute}`);

        const result = await run(api.instructions, { mcpClient, mcpTools, rateLimitConfig });
        log.success("Agent completed");
        log.info("Agent response:");
        console.log(result.response);

        // Send verification to verify endpoint
        log.start("Sending verification...");
        const verifyEndpoint = railwayConfig.endpoint;
        const apiKey = railwayConfig.apiKey;

        const response = await fetch(verifyEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                apikey: apiKey,
                task: railwayConfig.task,
                answer: {
                    action: "verify",
                    status: result.response
                }
            }),
        });

        const responseData = await response.json();
        if (!response.ok) {
            log.error(`Failed to verify: ${response.status} ${response.statusText}`);
            log.error("Response data:", JSON.stringify(responseData, null, 2));
            throw new Error(`Failed to verify: ${response.status} ${response.statusText}`);
        }

        log.success("Verification response:");
        console.log(JSON.stringify(responseData, null, 2));

        logStats();
    } catch (error) {
        log.error("Fatal error", error.message);
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
