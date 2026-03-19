import { appendFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { failureConfig } from "../config.js";

const colors = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    white: "\x1b[37m",
    blue: "\x1b[34m"
};

const LOG_FILE = path.join(failureConfig.logsDir, "agent.log");
const API_LOG_FILE = path.join(failureConfig.logsDir, "api.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024;

const timestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });

const ensureDir = async () => {
    await mkdir(failureConfig.logsDir, { recursive: true });
    if (failureConfig.debugArtifacts) {
        await mkdir(failureConfig.artifactsDir, { recursive: true });
    }
};

const rotateIfNeeded = async (filePath) => {
    try {
        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_LOG_SIZE) {
            const suffix = new Date().toISOString().replace(/[:.]/g, "-");
            await rename(filePath, `${filePath}.${suffix}`);
        }
    } catch {
        // ignore missing file
    }
};

const writeLine = async (filePath, level, message) => {
    await ensureDir();
    await rotateIfNeeded(filePath);
    await appendFile(filePath, `[${new Date().toISOString()}] [${level}] ${message}\n`, "utf8");
};

const emit = (icon, color, message) => {
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${color}${icon}${colors.reset} ${message}`);
};

const toLine = (value) => typeof value === "string" ? value : JSON.stringify(value);

const log = {
    async reset() {
        await ensureDir();
        await writeFile(LOG_FILE, "", "utf8");
        await writeFile(API_LOG_FILE, "", "utf8");
    },

    flush() {
        return Promise.resolve();
    },

    box(text) {
        const width = Math.max(...text.split("\n").map((line) => line.length)) + 4;
        console.log(`\n${colors.cyan}${"─".repeat(width)}${colors.reset}`);
        for (const line of text.split("\n")) {
            console.log(`${colors.cyan}│${colors.reset} ${line.padEnd(width - 3)}${colors.cyan}│${colors.reset}`);
        }
        console.log(`${colors.cyan}${"─".repeat(width)}${colors.reset}\n`);
    },

    info(message) {
        emit("i", colors.blue, message);
        return writeLine(LOG_FILE, "INFO", message);
    },

    start(message) {
        emit("→", colors.cyan, message);
        return writeLine(LOG_FILE, "START", message);
    },

    success(message) {
        emit("✓", colors.green, message);
        return writeLine(LOG_FILE, "SUCCESS", message);
    },

    warn(message) {
        emit("⚠", colors.yellow, message);
        return writeLine(LOG_FILE, "WARN", message);
    },

    error(title, message = "") {
        const full = message ? `${title}: ${message}` : title;
        emit("✗", colors.red, full);
        return writeLine(LOG_FILE, "ERROR", full);
    },

    debug(scope, value) {
        const line = `[${scope}] ${toLine(value)}`;
        emit("·", colors.white, line);
        return writeLine(LOG_FILE, "DEBUG", line);
    },

    data(scope, value) {
        const line = `[${scope}] ${toLine(value)}`;
        emit("◆", colors.magenta, line);
        return writeLine(LOG_FILE, "DATA", line);
    },

    api(scope, value) {
        const line = `[${scope}] ${toLine(value)}`;
        emit("◌", colors.cyan, line);
        return writeLine(API_LOG_FILE, "API", line);
    }
};

export const writeArtifact = async (name, payload) => {
    if (!failureConfig.debugArtifacts) {
        return;
    }

    await ensureDir();
    const artifactPath = path.join(failureConfig.artifactsDir, name);
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    await writeFile(artifactPath, serialized, "utf8");
};

export default log;
