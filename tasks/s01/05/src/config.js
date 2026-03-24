import { resolveModelForProvider } from "../../../config.js";

/**
 * Rate limiting configuration
 * Can be overridden via environment variables:
 * - RATE_LIMIT_API_DELAY - Delay between API calls in ms (default: 1000)
 * - RATE_LIMIT_TOOL_DELAY - Delay between tool calls in ms (default: 500)
 * - RATE_LIMIT_SEQUENTIAL - Run tools sequentially (default: true)
 * - RATE_LIMIT_MAX_RETRIES - Max retry attempts (default: 5)
 */
export const rateLimitConfig = {
    apiCallDelay: parseInt(process.env.RATE_LIMIT_API_DELAY) || 1000,
    toolCallDelay: parseInt(process.env.RATE_LIMIT_TOOL_DELAY) || 500,
    sequentialTools: process.env.RATE_LIMIT_SEQUENTIAL !== "false",
    maxRetries: parseInt(process.env.RATE_LIMIT_MAX_RETRIES) || 5,
    baseRetryDelay: 2000,
    maxRetryDelay: 60000
};

/**
 * Railway API configuration
 */
export const railwayConfig = {
    endpoint: process.env.VERIFY_ENDPOINT || "https://hub.ag3nts.org/verify",
    apiKey: process.env.HUB_API_KEY,
    task: "railway",
    targetRoute: "X-01"
};

/**
 * Cache configuration
 */
export const cacheConfig = {
    baseDir: "cache",
    ttl: parseInt(process.env.CACHE_TTL) || 300000, // 5 minutes default
    enabled: process.env.CACHE_ENABLED !== "false"
};

/**
 * Logging configuration
 */
export const loggingConfig = {
    consoleEnabled: true,
    fileEnabled: process.env.LOG_TO_FILE !== "false",
    logDir: "logs",
    logFile: "agent.log",
    maxLogSize: parseInt(process.env.MAX_LOG_SIZE) || 10485760 // 10MB
};

/**
 * AI API configuration
 */
export const api = {
    model: resolveModelForProvider("gpt-5-mini"),
    maxOutputTokens: 4096,
    instructions: `You are an autonomous agent responsible for activating railway routes.

## TASK
Activate railway route X-01 by setting its status to RTOPEN.

## AVAILABLE TOOLS

### Native Tools - Railway API
You have access to railway API tools:
- railway_help: Get available actions and parameters
- railway_reconfigure: Enable reconfigure mode for a route
- railway_getstatus: Get current status of a route
- railway_setstatus: Set route status (RTOPEN or RTCLOSE)
- railway_save: Exit reconfigure mode and save changes

### MCP Tools - File System
You have access to file system tools via MCP server:
- fs_read: Read files and list directories
- fs_search: Search for files and content
- fs_write: Write or update files
- fs_manage: Structural operations on files and directories

These tools can be used to:
- Log your actions and results
- Save intermediate state
- Read any configuration or knowledge files

## WORKFLOW
To activate a route, you must follow this sequence:
1. Call railway_help to understand available actions
2. Call railway_getstatus to check current status of X-01
3. Call railway_reconfigure for route X-01 to enter edit mode
4. Call railway_setstatus with route X-01 and value RTOPEN
5. Call railway_save for route X-01 to commit changes
6. Call railway_getstatus to verify the route is now RTOPEN

## IMPORTANT NOTES
- You MUST call reconfigure before setstatus
- You MUST call save after setstatus to apply changes
- Handle any errors gracefully and retry if needed
- Use fs_write to log your progress if helpful

## RESPONSE
After completing the task, report the final status of route X-01.`
};
