/**
 * Enhanced logger with both console and file output.
 */

import { appendFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    bgBlue: "\x1b[44m"
};

const LOG_DIR = join(PROJECT_ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "agent.log");
const API_LOG_FILE = join(LOG_DIR, "api.log");
const TOOLS_LOG_FILE = join(LOG_DIR, "tools.log");
const MAX_LOG_SIZE = 10485760; // 10MB

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

// Clear log files on app start
const clearLogFile = (logFile) => {
    try {
        if (existsSync(logFile)) {
            writeFileSync(logFile, "");
        }
    } catch (error) {
        console.error(`Failed to clear log file: ${error.message}`);
    }
};

// Clear all log files on startup
clearLogFile(LOG_FILE);
clearLogFile(API_LOG_FILE);
clearLogFile(TOOLS_LOG_FILE);

/**
 * Rotate log file if it exceeds max size
 */
const rotateLogIfNeeded = (logFile) => {
    if (existsSync(logFile)) {
        const stats = statSync(logFile);
        if (stats.size > MAX_LOG_SIZE) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            renameSync(logFile, `${logFile}.${timestamp}`);
        }
    }
};

/**
 * Write to log file
 */
const logToFile = (level, message, logFile = LOG_FILE) => {
    try {
        rotateLogIfNeeded(logFile);
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
        appendFileSync(logFile, logLine);
    } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
    }
};

const timestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const log = {
    info: (msg) => {
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${msg}`);
        logToFile("info", msg);
    },

    success: (msg) => {
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}✓${colors.reset} ${msg}`);
        logToFile("success", msg);
    },

    error: (title, msg) => {
        const fullMsg = msg ? `${title}: ${msg}` : title;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}✗ ${title}${colors.reset} ${msg || ""}`);
        logToFile("error", fullMsg);
    },

    warn: (msg) => {
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${msg}`);
        logToFile("warn", msg);
    },

    start: (msg) => {
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}→${colors.reset} ${msg}`);
        logToFile("start", msg);
    },

    box: (text) => {
        const lines = text.split("\n");
        const width = Math.max(...lines.map(l => l.length)) + 4;
        const boxTop = `\n${colors.cyan}${"─".repeat(width)}${colors.reset}`;
        const boxBottom = `${colors.cyan}${"─".repeat(width)}${colors.reset}\n`;

        console.log(boxTop);
        for (const line of lines) {
            console.log(`${colors.cyan}│${colors.reset} ${colors.bright}${line.padEnd(width - 3)}${colors.reset}${colors.cyan}│${colors.reset}`);
        }
        console.log(boxBottom);

        logToFile("info", `=== ${text.replace(/\n/g, " | ")} ===`);
    },

    query: (q) => {
        console.log(`\n${colors.bgBlue}${colors.white} QUERY ${colors.reset} ${q}\n`);
        logToFile("query", q);
    },

    response: (r) => {
        const truncated = r.length > 200 ? r.substring(0, 200) + "..." : r;
        console.log(`\n${colors.green}Response:${colors.reset} ${truncated}\n`);
        logToFile("response", r);
    },

    api: (step, msgCount) => {
        const msg = `${step} (${msgCount} messages)`;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.magenta}◆${colors.reset} ${msg}`);
        logToFile("api", msg, API_LOG_FILE);
    },

    apiDone: (usage) => {
        if (usage) {
            const msg = `tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`;
            console.log(`${colors.dim}         ${msg}${colors.reset}`);
            logToFile("api", msg, API_LOG_FILE);
        }
    },

    tool: (name, args) => {
        const argStr = JSON.stringify(args);
        const truncated = argStr.length > 100 ? argStr.substring(0, 100) + "..." : argStr;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⚡${colors.reset} ${name} ${colors.dim}${truncated}${colors.reset}`);
        logToFile("tool", `${name}: ${argStr}`, TOOLS_LOG_FILE);
    },

    toolResult: (name, success, output) => {
        const icon = success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
        const truncated = output.length > 150 ? output.substring(0, 150) + "..." : output;
        console.log(`${colors.dim}         ${icon} ${truncated}${colors.reset}`);
        logToFile("tool", `Result [${success ? "SUCCESS" : "FAILED"}] ${name}: ${output}`, TOOLS_LOG_FILE);
    },

    debug: (scope, msg) => {
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.white}·${colors.reset} ${scope}: ${msg}`);
        logToFile("debug", `[${scope}] ${msg}`);
    },

    debugJson: (scope, value) => {
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        const truncated = serialized.length > 400 ? serialized.substring(0, 400) + "..." : serialized;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.white}·${colors.reset} ${scope}: ${truncated}`);
        logToFile("debug", `[${scope}] ${serialized}`);
    },

    rateLimit: (violations, penalty, waitTime) => {
        const msg = `Rate limited! Violations: ${violations}, Penalty: ${penalty}s, Waiting: ${waitTime}s`;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⏱${colors.reset} ${msg}`);
        logToFile("rateLimit", msg);
    },

    cache: (action, key) => {
        const msg = `Cache ${action}: ${key}`;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.blue}💾${colors.reset} ${msg}`);
        logToFile("cache", msg);
    },

    railway: (action, route, result) => {
        const msg = `Railway ${action} for ${route}: ${result}`;
        console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.magenta}🚂${colors.reset} ${msg}`);
        logToFile("railway", msg);
    }
};

export default log;
