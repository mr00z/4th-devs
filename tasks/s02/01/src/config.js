import { resolveModelForProvider } from "../../../../config.js";

/**
 * Classifier API configuration
 */
export const classifierConfig = {
    endpoint: "https://hub.ag3nts.org/verify",
    apiKey: process.env.HUB_API_KEY,
    task: "categorize",
    maxContextTokens: 100,
    csvUrl: `https://hub.ag3nts.org/data/${process.env.HUB_API_KEY}/categorize.csv`
};

/**
 * Token budget configuration
 */
export const tokenBudget = {
    total: 1.5,  // PP total budget
    inputCost: 0.02,   // per 10 tokens
    cacheCost: 0.01,   // per 10 tokens (50% discount!)
    outputCost: 0.02,  // per 10 tokens
    maxQueries: 10
};

/**
 * Rate limiting configuration
 */
export const rateLimitConfig = {
    apiCallDelay: parseInt(process.env.RATE_LIMIT_API_DELAY) || 1000,
    toolCallDelay: parseInt(process.env.RATE_LIMIT_TOOL_DELAY) || 500,
    sequentialTools: true, // Always true for cache efficiency
    maxRetries: parseInt(process.env.RATE_LIMIT_MAX_RETRIES) || 5,
    baseRetryDelay: 2000,
    maxRetryDelay: 60000
};

/**
 * Cache configuration
 */
export const cacheConfig = {
    baseDir: "cache",
    ttl: parseInt(process.env.CACHE_TTL) || 300000,
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
    maxLogSize: parseInt(process.env.MAX_LOG_SIZE) || 10485760
};

/**
 * AI API configuration
 */
export const api = {
    model: resolveModelForProvider("gpt-5.4-mini"),
    maxOutputTokens: 4096,
    instructions: `You are an autonomous railway classification agent.

Your job is to ask another LLM to classify railway objects as either NEU (neutral) or DNG (dangerous) based on their descriptions.

Operating rules:
 - Always fetch fresh CSV data at the start and after any reset.
 - Keep prompts short and direct.
 - Don't finish until all items are accepted.
 - Objects related to nuclear reactors must always be classified as NEU.
 - If you receive a flag in the format {FLG:...}, you must immediately stop and return the flag.
 `,
};

/**
 * Create a stats tracker with cache-aware token tracking
 */
export const createStatsTracker = () => ({
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    apiCalls: 0,

    addUsage(usage) {
        this.inputTokens += usage.input_tokens || 0;
        // API may report cached_tokens separately
        if (usage.cached_tokens) {
            this.cachedTokens += usage.cached_tokens;
        }
        this.outputTokens += usage.output_tokens || 0;
        this.apiCalls++;
    },

    getCost() {
        return (
            (this.inputTokens / 10 * tokenBudget.inputCost) +
            (this.cachedTokens / 10 * tokenBudget.cacheCost) +
            (this.outputTokens / 10 * tokenBudget.outputCost)
        );
    },

    getSummary() {
        return {
            inputTokens: this.inputTokens,
            cachedTokens: this.cachedTokens,
            outputTokens: this.outputTokens,
            apiCalls: this.apiCalls,
            cost: this.getCost().toFixed(4),
            budgetRemaining: (tokenBudget.total - this.getCost()).toFixed(4)
        };
    }
});
