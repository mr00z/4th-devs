/**
 * Native railway API tools for the agent.
 * Maps railway API actions to LLM-callable tools.
 * API responses are saved to cache files programmatically.
 */

import log from "../helpers/logger.js";
import { setCachedResponse, readCachedData } from "../helpers/cache.js";
import {
    getHelp,
    reconfigureRoute,
    getRouteStatus,
    setRouteStatus,
    saveRoute
} from "../railway/api.js";

/**
 * Native tool definitions in OpenAI function format.
 */
export const nativeTools = [
    {
        type: "function",
        name: "railway_help",
        description: "Get available railway API actions and their parameters. Use this to understand what actions are available and their required parameters.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "railway_reconfigure",
        description: "Enable reconfigure mode for a railway route. Must be called BEFORE setting route status. This puts the route into edit mode.",
        parameters: {
            type: "object",
            properties: {
                route: {
                    type: "string",
                    description: "Route identifier in format [A-Z]-[0-9]{1,2}.Example: 'X-01'"
                }
            },
            required: ["route"],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "railway_getstatus",
        description: "Get current status for a railway route. Returns RTOPEN (open) or RTCLOSE (closed).",
        parameters: {
            type: "object",
            properties: {
                route: {
                    type: "string",
                    description: "Route identifier in format [A-Z]-[0-9]{1,2}. Example: 'X-01'"
                }
            },
            required: ["route"],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "railway_setstatus",
        description: "Set railway route status. Route MUST be in reconfigure mode first.",
        parameters: {
            type: "object",
            properties: {
                route: {
                    type: "string",
                    description: "Route identifier in format [A-Z]-[0-9]{1,2}. Example: 'X-01'"
                },
                value: {
                    type: "string",
                    enum: ["RTOPEN", "RTCLOSE"],
                    description: "Status value: RTOPEN to open route, RTCLOSE to close route"
                }
            },
            required: ["route", "value"],
            additionalProperties: false
        },
        strict: true
    },
    {
        type: "function",
        name: "railway_save",
        description: "Exit reconfigure mode for a railway route and save changes. Call this AFTER railway_setstatus. Response is saved to cache/save/{route}.json",
        parameters: {
            type: "object",
            properties: {
                route: {
                    type: "string",
                    description: "Route identifier in format [A-Z]-[0-9]{1,2}. Example: 'X-01'"
                }
            },
            required: ["route"],
            additionalProperties: false
        },
        strict: true
    }
];

/**
 * Native tool handlers.
 * Each handler saves the API response to a cache file and returns the file path.
 */
export const nativeHandlers = {
    async railway_help() {
        try {
            log.start("Getting railway API help...");

            // Check for existing cache
            const cached = await readCachedData("help", {});
            if (cached) {
                log.info("Using cached help response");
                return {
                    success: true,
                    cached: true,
                    cacheFilePath: cached.filePath,
                    data: cached.data.response
                };
            }

            const result = await getHelp();
            const cacheFilePath = await setCachedResponse("help", {}, result);
            log.success("Retrieved railway API actions");

            return {
                success: true,
                cacheFilePath,
                data: result
            };
        } catch (error) {
            log.error("Railway help failed", error.message);
            return { success: false, error: error.message };
        }
    },

    async railway_reconfigure({ route }) {
        try {
            const normalizedRoute = route.toUpperCase();
            log.start(`Enabling reconfigure mode for route ${normalizedRoute}...`);

            const result = await reconfigureRoute(normalizedRoute);
            const cacheFilePath = await setCachedResponse("reconfigure", { route: normalizedRoute }, result);
            log.success(`Reconfigure mode enabled for ${normalizedRoute}`);

            return {
                success: true,
                route: normalizedRoute,
                cacheFilePath,
                data: result
            };
        } catch (error) {
            log.error(`Reconfigure failed for ${route}`, error.message);
            return { success: false, route, error: error.message };
        }
    },

    async railway_getstatus({ route }) {
        try {
            const normalizedRoute = route.toUpperCase();
            log.start(`Getting status for route ${normalizedRoute}...`);

            const result = await getRouteStatus(normalizedRoute);
            const status = result.status || "unknown";
            const cacheFilePath = await setCachedResponse("getstatus", { route: normalizedRoute }, result);
            log.success(`Route ${normalizedRoute} status: ${status}`);

            return {
                success: true,
                route: normalizedRoute,
                status,
                cacheFilePath,
                data: result
            };
        } catch (error) {
            log.error(`Get status failed for ${route}`, error.message);
            return { success: false, route, error: error.message };
        }
    },

    async railway_setstatus({ route, value }) {
        try {
            const normalizedRoute = route.toUpperCase();
            const normalizedValue = value.toUpperCase();
            log.start(`Setting route ${normalizedRoute} status to ${normalizedValue}...`);

            const result = await setRouteStatus(normalizedRoute, normalizedValue);
            const cacheFilePath = await setCachedResponse("setstatus", { route: normalizedRoute, value: normalizedValue }, result);
            log.success(`Route ${normalizedRoute} status set to ${normalizedValue}`);

            return {
                success: true,
                route: normalizedRoute,
                value: normalizedValue,
                cacheFilePath,
                data: result
            };
        } catch (error) {
            log.error(`Set status failed for ${route}`, error.message);
            return { success: false, route, value, error: error.message };
        }
    },

    async railway_save({ route }) {
        try {
            const normalizedRoute = route.toUpperCase();
            log.start(`Saving changes for route ${normalizedRoute}...`);

            const result = await saveRoute(normalizedRoute);
            const cacheFilePath = await setCachedResponse("save", { route: normalizedRoute }, result);
            log.success(`Changes saved for ${normalizedRoute}`);

            return {
                success: true,
                route: normalizedRoute,
                cacheFilePath,
                data: result
            };
        } catch (error) {
            log.error(`Save failed for ${route}`, error.message);
            return { success: false, route, error: error.message };
        }
    }
};

/**
 * Check if a tool is native (not MCP).
 */
export const isNativeTool = (name) => name in nativeHandlers;

/**
 * Execute a native tool.
 */
export const executeNativeTool = async (name, args) => {
    const handler = nativeHandlers[name];
    if (!handler) throw new Error(`Unknown native tool: ${name}`);
    return handler(args);
};
