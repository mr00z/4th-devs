/**
 * Rate limiting utilities with enhanced 429 and 503 handling.
 * Parses rate limit headers and applies penalties.
 */

import log from "./logger.js";

/**
 * Delays execution for a specified number of milliseconds
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Default configuration for rate limiting
 */
export const defaultRateLimitConfig = {
    apiCallDelay: 3000,
    toolCallDelay: 1500,
    sequentialTools: true,
    maxRetries: 10,
    baseRetryDelay: 2000,
    maxRetryDelay: 60000,
    violationThreshold: 10
};

/**
 * Rate limit state tracking
 */
let rateLimitState = {
    limit: 1,
    remaining: 1,
    resetTime: null,
    policy: "1;w=30",
    violations: 0,
    penalty: 0,
    lastViolationTime: null
};

/**
 * Parse rate limit headers from response
 */
export const parseRateLimitHeaders = (headers) => {
    return {
        limit: parseInt(headers.get("x-ratelimit-limit")) || 1,
        remaining: parseInt(headers.get("x-ratelimit-remaining")) ?? 1,
        resetTime: parseInt(headers.get("x-ratelimit-reset")) || null,
        policy: headers.get("x-ratelimit-policy") || "1;w=30",
        violations: parseInt(headers.get("x-ratelimit-violations")) || 0,
        penalty: parseInt(headers.get("x-ratelimit-penalty")) || 0,
        retryAfter: parseInt(headers.get("retry-after")) || 0
    };
};

/**
 * Calculate wait time considering penalty and reset time
 */
export const calculateWaitTime = (rateLimitInfo) => {
    const { retryAfter, penalty, resetTime } = rateLimitInfo;
    const now = Math.floor(Date.now() / 1000);
    const timeUntilReset = resetTime ? Math.max(0, resetTime - now) : 0;

    // Use the maximum of retryAfter, penalty, or time until reset
    // Add 1 second buffer for safety
    return Math.max(retryAfter, penalty, timeUntilReset) + 1;
};

/**
 * Update rate limit state from response headers
 */
export const updateRateLimitState = (headers) => {
    const info = parseRateLimitHeaders(headers);
    rateLimitState = {
        ...rateLimitState,
        ...info
    };

    if (info.violations > rateLimitState.violations) {
        rateLimitState.lastViolationTime = Date.now();
    }

    log.debug("rateLimiter", `State: remaining=${info.remaining}, violations=${info.violations}, penalty=${info.penalty}s`);
    return info;
};

/**
 * Get current rate limit state
 */
export const getRateLimitState = () => ({ ...rateLimitState });

/**
 * Check if we've exceeded the violation threshold
 */
export const checkViolationThreshold = (config = {}) => {
    const threshold = config.violationThreshold || defaultRateLimitConfig.violationThreshold;
    if (rateLimitState.violations >= threshold) {
        throw new Error(`Rate limit violation threshold exceeded: ${rateLimitState.violations} violations (threshold: ${threshold})`);
    }
};

/**
 * Proactive rate limit check - wait if we're at limit
 */
export const checkRateLimit = async (logInstance = log) => {
    if (rateLimitState.remaining <= 0 && rateLimitState.resetTime) {
        const now = Math.floor(Date.now() / 1000);
        const waitTime = rateLimitState.resetTime - now;
        if (waitTime > 0) {
            logInstance.rateLimit(rateLimitState.violations, rateLimitState.penalty, waitTime);
            logInstance.info(`Rate limit reached. Waiting ${waitTime}s until reset...`);
            await delay(waitTime * 1000);
        }
    }
};

/**
 * Handle 429 Too Many Requests response
 */
export const handleRateLimitResponse = async (response, logInstance = log) => {
    const info = updateRateLimitState(response.headers);
    const waitTime = calculateWaitTime(info);

    logInstance.rateLimit(info.violations, info.penalty, waitTime);

    // Check violation threshold
    if (info.violations >= 5) {
        logInstance.warn(`High violation count: ${info.violations}. Consider slowing down.`);
    }

    logInstance.info(`Waiting ${waitTime}s before retry...`);
    await delay(waitTime * 1000);
    return info;
};

/**
 * Calculates exponential backoff delay with jitter
 */
export const calculateBackoff = (attempt, baseDelay, maxDelay) => {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, maxDelay);
};

/**
 * Handle 503 Service Unavailable
 */
export const handleServiceUnavailable = async (attempt, config = {}, logInstance = log) => {
    const { baseRetryDelay, maxRetryDelay } = { ...defaultRateLimitConfig, ...config };
    const backoff = calculateBackoff(attempt, baseRetryDelay, maxRetryDelay);
    logInstance.warn(`Service unavailable. Retrying in ${Math.round(backoff / 1000)}s...`);
    await delay(backoff);
    return backoff;
};

/**
 * Check if an error is a rate limit error
 */
export const isRateLimitError = (error) => {
    if (!error) return false;
    const message = error.message?.toLowerCase() || "";
    return message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("too many requests") ||
        message.includes("ratelimit");
};

/**
 * Check if an error is a service unavailable error
 */
export const isServiceUnavailableError = (error) => {
    if (!error) return false;
    const message = error.message?.toLowerCase() || "";
    return message.includes("503") ||
        message.includes("service unavailable");
};

/**
 * Executes a function with retry logic for rate limiting and service errors
 */
export const withRetry = async (fn, operationName, config = {}) => {
    const {
        maxRetries,
        baseRetryDelay,
        maxRetryDelay
    } = { ...defaultRateLimitConfig, ...config };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Proactive rate limit check
            await checkRateLimit();

            if (attempt > 0) {
                log.info(`Retry attempt ${attempt}/${maxRetries} for ${operationName}`);
            }

            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries;

            if (isRateLimitError(error) && !isLastAttempt) {
                log.warn(`Rate limit hit for ${operationName}`);
                // Note: The actual retry-after handling should be done by the caller
                // who has access to the response headers
                const backoffDelay = calculateBackoff(attempt, baseRetryDelay * 2, maxRetryDelay);
                await delay(backoffDelay);
            } else if (isServiceUnavailableError(error) && !isLastAttempt) {
                await handleServiceUnavailable(attempt, config);
            } else if (!isLastAttempt) {
                // For non-specific errors, still retry with shorter delay
                const backoffDelay = calculateBackoff(attempt, baseRetryDelay, maxRetryDelay);
                log.warn(`Error in ${operationName}: ${error.message}. Retrying in ${Math.round(backoffDelay / 1000)}s...`);
                await delay(backoffDelay);
            } else {
                throw error;
            }
        }
    }
};

/**
 * Delays execution if needed between operations
 */
export const enforceMinDelay = async (lastCallTime, minDelay) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall < minDelay) {
        const remainingDelay = minDelay - timeSinceLastCall;
        log.debug("rateLimiter", `Enforcing ${remainingDelay}ms delay`);
        await delay(remainingDelay);
    }

    return Date.now();
};
