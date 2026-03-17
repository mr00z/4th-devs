/**
 * Railway Object Classifier Agent
 * Classifies railway objects via hub.ag3nts.org/verify API
 * Reactor-related objects must be classified as NEU (not DNG)
 */

import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { run } from "./src/agent.js";
import { nativeTools } from "./src/native/tools.js";
import log from "./src/helpers/logger.js";
import { logStats } from "./src/helpers/stats.js";
import { api, rateLimitConfig, classifierConfig } from "./src/config.js";
import { rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Clear CSV cache on startup
const CSV_CACHE_DIR = join(__dirname, "cache", "csv");
if (existsSync(CSV_CACHE_DIR)) {
    try {
        rmSync(CSV_CACHE_DIR, { recursive: true, force: true });
        log.info("CSV cache cleared on startup");
    } catch (error) {
        log.warn(`Failed to clear CSV cache: ${error.message}`);
    }
}

const main = async () => {
    log.box("Railway Object Classifier\nClassify objects | Reactor → NEU | Capture FLG");

    // Validate API key
    if (!classifierConfig.apiKey) {
        log.error("HUB_API_KEY environment variable is not set");
        log.info("Make sure .env file exists in the project root with HUB_API_KEY set");
        process.exit(1);
    }

    log.info(`CSV Endpoint: ${classifierConfig.csvUrl.replace(classifierConfig.apiKey, "***")}`);
    log.info(`Classifier Endpoint: ${classifierConfig.endpoint}`);
    log.info(`Max Context Tokens: ${classifierConfig.maxContextTokens}`);
    log.info(`Rate limiting: ${rateLimitConfig.sequentialTools ? "sequential" : "parallel"} tools, ${rateLimitConfig.apiCallDelay}ms API delay`);

    let mcpClient;

    try {
        log.start("Connecting to MCP server...");
        mcpClient = await createMcpClient();
        const mcpTools = await listMcpTools(mcpClient);
        log.success(`MCP tools: ${mcpTools.map((tool) => tool.name).join(", ")}`);
        log.success(`Native tools: ${nativeTools.map((tool) => tool.name).join(", ")}`);

        log.start("Starting classification workflow...");
        log.info("The agent will:");
        log.info("  1. Fetch CSV data from hub");
        log.info("  2. Classify each object sequentially (for cache efficiency)");
        log.info("  3. Ensure reactor items are classified as NEU");
        log.info("  4. Reset and re-fetch if token limit reached");
        log.info("  5. Capture the FLG secret when all classified correctly");

        const result = await run(api.instructions, {
            mcpClient,
            mcpTools,
            rateLimitConfig
        });

        log.success("Agent completed");
        log.info("Final response:");
        console.log("\n" + "=".repeat(60));
        console.log(result.response);
        console.log("=".repeat(60) + "\n");

        // Check for flag in response
        const flagMatch = result.response.match(/\{FLG:([^}]+)\}/);
        if (flagMatch) {
            log.success("╔════════════════════════════════════════════════════════╗");
            log.success("║  SECRET FLAG CAPTURED                                  ║");
            log.success(`║  FLG: ${flagMatch[1].padEnd(44)} ║`);
            log.success("╚════════════════════════════════════════════════════════╝");
        } else {
            log.warn("No flag found in response. Classification may not be complete.");
        }

        logStats();
    } catch (error) {
        log.error("Fatal error", error.message);

        if (error.message.includes("rate limit") || error.message.includes("429")) {
            log.warn("Rate limit hit. Consider increasing RATE_LIMIT_API_DELAY.");
        }

        if (error.message.includes("token") || error.message.includes("context")) {
            log.warn("Token limit may have been reached. The classifier_reset tool can be used to reset.");
        }

        throw error;
    } finally {
        if (mcpClient) {
            await mcpClient.close().catch(() => { });
        }
    }
};

// Handle graceful shutdown
process.on("SIGINT", () => {
    log.warn("\nReceived SIGINT, shutting down gracefully...");
    logStats();
    process.exit(0);
});

process.on("SIGTERM", () => {
    log.warn("\nReceived SIGTERM, shutting down gracefully...");
    logStats();
    process.exit(0);
});

main().catch((error) => {
    log.error("Startup error", error.message);
    process.exit(1);
});
