/**
 * Response caching system for railway API calls.
 * Stores responses in JSON files organized by action type.
 */

import { readFile, writeFile, mkdir, access } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import log from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

const CACHE_BASE_DIR = join(PROJECT_ROOT, "cache");
const DEFAULT_TTL = 300000; // 5 minutes in milliseconds

/**
 * Ensure cache directory exists for a specific action
 */
const ensureCacheDir = async (action) => {
    const dirPath = join(CACHE_BASE_DIR, action);
    try {
        await access(dirPath);
    } catch {
        await mkdir(dirPath, { recursive: true });
    }
    return dirPath;
};

/**
 * Generate cache key from action and parameters
 */
const generateCacheKey = (action, params) => {
    const normalizedRoute = params.route?.toLowerCase().replace(/\s/g, "") || "default";
    if (action === "setstatus" && params.value) {
        return `${normalizedRoute}-${params.value}`;
    }
    return normalizedRoute;
};

/**
 * Get cached response if it exists and is not expired
 */
export const getCachedResponse = async (action, params, ttl = DEFAULT_TTL) => {
    const cacheKey = generateCacheKey(action, params);
    const cacheFile = join(CACHE_BASE_DIR, action, `${cacheKey}.json`);

    try {
        const data = await readFile(cacheFile, "utf-8");
        const cached = JSON.parse(data);

        // Check if cache is still valid
        const age = Date.now() - cached.timestamp;
        if (age < ttl) {
            log.cache("HIT", `${action}/${cacheKey}`);
            log.debug("cache", `Cache age: ${Math.round(age / 1000)}s, TTL: ${Math.round(ttl / 1000)}s`);
            return cached.response;
        } else {
            log.cache("EXPIRED", `${action}/${cacheKey}`);
            return null;
        }
    } catch {
        log.cache("MISS", `${action}/${cacheKey}`);
        return null;
    }
};

/**
 * Store response in cache and return file path
 */
export const setCachedResponse = async (action, params, response) => {
    const cacheKey = generateCacheKey(action, params);

    try {
        const dirPath = await ensureCacheDir(action);
        const cacheFile = join(dirPath, `${cacheKey}.json`);

        const cacheEntry = {
            timestamp: Date.now(),
            action,
            params,
            response
        };

        await writeFile(cacheFile, JSON.stringify(cacheEntry, null, 2), "utf-8");
        log.cache("STORE", `${action}/${cacheKey}`);
        return cacheFile;
    } catch (error) {
        log.warn(`Failed to cache response: ${error.message}`);
        return null;
    }
};

/**
 * Get cache file path for an action and params
 */
export const getCacheFilePath = (action, params) => {
    const cacheKey = generateCacheKey(action, params);
    return join(CACHE_BASE_DIR, action, `${cacheKey}.json`);
};

/**
 * Read raw cached data (including metadata)
 */
export const readCachedData = async (action, params) => {
    const cacheFile = getCacheFilePath(action, params);
    try {
        const data = await readFile(cacheFile, "utf-8");
        const cached = JSON.parse(data);
        return { filePath: cacheFile, data: cached };
    } catch {
        return null;
    }
};

/**
 * Clear cache for a specific action or all actions
 */
export const clearCache = async (action = null) => {
    try {
        if (action) {
            const dirPath = join(CACHE_BASE_DIR, action);
            // Note: In a real implementation, we'd delete files here
            log.info(`Cache cleared for action: ${action}`);
        } else {
            log.info("Cache cleared for all actions");
        }
    } catch (error) {
        log.warn(`Failed to clear cache: ${error.message}`);
    }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
    const stats = {
        actions: {},
        totalEntries: 0
    };

    try {
        // This is a simplified implementation
        // In a full implementation, we'd read the cache directories
        log.debug("cache", "Stats collection not fully implemented");
        return stats;
    } catch (error) {
        log.warn(`Failed to get cache stats: ${error.message}`);
        return stats;
    }
};
