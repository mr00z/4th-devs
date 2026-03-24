/**
 * Classifier API client for communicating with hub.ag3nts.org/verify
 * Handles CSV fetching and classification requests
 */

import { classifierConfig } from "../config.js";
import log from "../helpers/logger.js";

/**
 * Fetch CSV data from the hub
 * @returns {Promise<Array<{code: string, description: string}>>}
 */
export const fetchCsvData = async () => {
    const { csvUrl, apiKey } = classifierConfig;

    if (!apiKey) {
        throw new Error("HUB_API_KEY environment variable is not set");
    }

    log.start("Fetching CSV data from hub...");

    try {
        const response = await fetch(csvUrl);

        if (!response.ok) {
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        const objects = parseCsv(csvText);

        log.success(`Fetched ${objects.length} objects from CSV`);
        return objects;
    } catch (error) {
        log.error("CSV fetch failed", error.message);
        throw error;
    }
};

/**
 * Parse CSV text into array of objects
 * @param {string} csvText
 * @returns {Array<{code: string, description: string}>}
 */
const parseCsv = (csvText) => {
    const lines = csvText.trim().split("\n");

    // Skip header
    if (lines.length < 2) {
        return [];
    }

    const objects = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line (handle quoted fields)
        const match = line.match(/^([^,]+),"(.*)"$/);
        if (match) {
            objects.push({
                code: match[1],
                description: match[2]
            });
        } else {
            // Simple split for non-quoted
            const parts = line.split(",");
            if (parts.length >= 2) {
                objects.push({
                    code: parts[0],
                    description: parts.slice(1).join(",").replace(/^"|"$/g, "")
                });
            }
        }
    }

    return objects;
};

/**
 * Send classification prompt to the classifier
 * @param {string} prompt - The classification prompt (max 100 tokens)
 * @returns {Promise<{response: string, isReset: boolean, isFlag: boolean, flag?: string}>}
 */
export const sendPrompt = async (prompt) => {
    const { endpoint, apiKey, task } = classifierConfig;

    if (!apiKey) {
        throw new Error("HUB_API_KEY environment variable is not set");
    }

    log.debug("classifier", `Sending prompt: ${prompt.substring(0, 50)}...`);

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                apikey: apiKey,
                task: task,
                answer: {
                    prompt: prompt
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            let parsedError = null;

            try {
                parsedError = JSON.parse(errorText);
            } catch {
                parsedError = null;
            }

            const error = new Error(`Classifier API error: ${response.status} ${response.statusText} - ${errorText}`);
            error.status = response.status;
            error.details = parsedError;
            error.errorCode = parsedError?.code ?? null;
            throw error;
        }

        const data = await response.json();
        const responseText = typeof data === "string" ? data : JSON.stringify(data);

        log.debug("classifier", `Response: ${responseText.substring(0, 100)}...`);

        // Check for flag in response
        const flagMatch = responseText.match(/\{FLG:([^}]+)\}/);
        if (flagMatch) {
            log.success(`Flag received: ${flagMatch[1]}`);
            return {
                response: responseText,
                isReset: false,
                isFlag: true,
                flag: flagMatch[1]
            };
        }

        // Check if it's a reset message
        const isReset = responseText.toLowerCase().includes("reset") ||
            responseText.toLowerCase().includes("context cleared");

        return {
            response: responseText,
            isReset,
            isFlag: false
        };
    } catch (error) {
        log.error("Classifier send failed", error.message);
        throw error;
    }
};
