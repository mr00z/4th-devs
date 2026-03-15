/**
 * Railway API client with rate limit handling and response caching.
 * Communicates with hub.ag3nts.org/verify endpoint.
 */

import { railwayConfig } from "../config.js";
import log from "../helpers/logger.js";
import {
    handleRateLimitResponse,
    handleServiceUnavailable,
    delay,
    calculateBackoff,
    defaultRateLimitConfig
} from "../helpers/rateLimiter.js";
import { getCachedResponse, setCachedResponse } from "../helpers/cache.js";

/**
 * Makes a request to the railway API with caching and rate limit handling
 */
export const callRailwayApi = async (action, params = {}, useCache = true) => {
    const { endpoint, apiKey, task } = railwayConfig;

    if (!apiKey) {
        throw new Error("HUB_API_KEY environment variable is not set");
    }

    // Check cache first
    if (useCache && action !== "setstatus") {
        const cached = await getCachedResponse(action, params);
        if (cached) {
            return cached;
        }
    }

    const requestBody = {
        apikey: apiKey,
        task,
        answer: {
            action,
            ...params
        }
    };

    log.debug("railway", `API call: ${action} with params ${JSON.stringify(params)}`);

    let lastError = null;
    const maxRetries = defaultRateLimitConfig.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
            });

            // Handle rate limit (429)
            if (response.status === 429) {
                log.warn(`Rate limited (429) on attempt ${attempt + 1}/${maxRetries + 1}`);
                await handleRateLimitResponse(response);
                continue; // Retry after waiting
            }

            // Handle service unavailable (503)
            if (response.status === 503) {
                log.warn(`Service unavailable (503) on attempt ${attempt + 1}/${maxRetries + 1}`);
                if (attempt < maxRetries) {
                    await handleServiceUnavailable(attempt);
                    continue;
                }
                throw new Error("Service unavailable after max retries");
            }

            // Handle other errors
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            // Parse response
            const data = await response.json();
            log.debug("railway", `API response: ${JSON.stringify(data).substring(0, 200)}`);

            // Cache successful response (except for setstatus)
            if (action !== "setstatus") {
                await setCachedResponse(action, params, data);
            }

            // Log successful railway operation
            if (params.route) {
                log.railway(action, params.route, data.ok ? "SUCCESS" : "FAILED");
            }

            return data;
        } catch (error) {
            lastError = error;

            // Don't retry on client errors (4xx except 429)
            if (error.message?.includes("400") ||
                error.message?.includes("401") ||
                error.message?.includes("403") ||
                error.message?.includes("404")) {
                throw error;
            }

            if (attempt < maxRetries) {
                const backoff = calculateBackoff(attempt, defaultRateLimitConfig.baseRetryDelay, defaultRateLimitConfig.maxRetryDelay);
                log.warn(`API call failed: ${error.message}. Retrying in ${Math.round(backoff / 1000)}s...`);
                await delay(backoff);
            }
        }
    }

    throw lastError || new Error("API call failed after max retries");
};

/**
 * Get available actions (help)
 */
export const getHelp = async () => {
    return callRailwayApi("help");
};

/**
 * Enable reconfigure mode for a route
 */
export const reconfigureRoute = async (route) => {
    return callRailwayApi("reconfigure", { route }, false);
};

/**
 * Get current status for a route
 */
export const getRouteStatus = async (route) => {
    return callRailwayApi("getstatus", { route });
};

/**
 * Set route status
 */
export const setRouteStatus = async (route, value) => {
    return callRailwayApi("setstatus", { route, value }, false);
};

/**
 * Save changes and exit reconfigure mode
 */
export const saveRoute = async (route) => {
    return callRailwayApi("save", { route }, false);
};
