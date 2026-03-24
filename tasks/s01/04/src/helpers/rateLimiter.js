/**
 * Rate limiting utilities for delaying API calls and handling rate limit errors
 */

import log from "./logger.js";

/**
 * Delays execution for a specified number of milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Default configuration for rate limiting
 */
export const defaultRateLimitConfig = {
    // Delay between API calls (in milliseconds)
    apiCallDelay: 1000,

    // Delay between tool calls (in milliseconds)
    toolCallDelay: 500,

    // Whether to run tools sequentially (true) or in parallel (false)
    sequentialTools: true,

    // Retry configuration
    maxRetries: 3,
    baseRetryDelay: 2000,
    maxRetryDelay: 30000,

    // Rate limit specific retry multiplier
    rateLimitMultiplier: 2
};

/**
 * Calculates exponential backoff delay with jitter
 * @param {number} attempt - Current retry attempt (0-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} - Delay in milliseconds
 */
export const calculateBackoff = (attempt, baseDelay, maxDelay) => {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, maxDelay);
};

/**
 * Checks if an error is a rate limit error
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
export const isRateLimitError = (error) => {
    if (!error) return false;
    const message = error.message?.toLowerCase() || '';
    return message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('ratelimit');
};

/**
 * Executes a function with retry logic for rate limiting
 * @param {Function} fn - The function to execute
 * @param {string} operationName - Name of the operation for logging
 * @param {Object} config - Rate limiting configuration
 * @returns {Promise<any>} - Result of the function
 */
export const withRetry = async (fn, operationName, config = {}) => {
    const { maxRetries, baseRetryDelay, maxRetryDelay } = { ...defaultRateLimitConfig, ...config };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                log.info(`Retry attempt ${attempt}/${maxRetries} for ${operationName}`);
            }

            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries;

            if (isRateLimitError(error) && !isLastAttempt) {
                const backoffDelay = calculateBackoff(attempt, baseRetryDelay, maxRetryDelay);
                log.warn(`Rate limit hit for ${operationName}. Retrying in ${Math.round(backoffDelay / 1000)}s...`);
                await delay(backoffDelay);
            } else if (!isLastAttempt) {
                // For non-rate-limit errors, still retry with shorter delay
                const backoffDelay = calculateBackoff(attempt, baseRetryDelay / 2, maxRetryDelay);
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
 * @param {number} lastCallTime - Timestamp of last call
 * @param {number} minDelay - Minimum delay between calls
 * @returns {Promise<number>} - New timestamp after delay
 */
export const enforceMinDelay = async (lastCallTime, minDelay) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall < minDelay) {
        const remainingDelay = minDelay - timeSinceLastCall;
        log.debug('rateLimiter', `Enforcing ${remainingDelay}ms delay`);
        await delay(remainingDelay);
    }

    return Date.now();
};
