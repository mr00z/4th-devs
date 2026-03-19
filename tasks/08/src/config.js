import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveModelForProvider } from "../../../config.js";

const TASK_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(TASK_DIR, "..");
const ROOT_DIR = path.resolve(TASK_DIR, "../../..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");
const WORKING_DIR_ENV_FILE = path.resolve(process.cwd(), ".env");

const loadEnvFallback = (envFilePath) => {
    const content = readFileSync(envFilePath, "utf8");

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
};

const loadEnvFile = (envFilePath) => {
    if (!existsSync(envFilePath)) {
        return;
    }

    if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(envFilePath);
    } else {
        loadEnvFallback(envFilePath);
    }
};

loadEnvFile(ROOT_ENV_FILE);

if (WORKING_DIR_ENV_FILE !== ROOT_ENV_FILE) {
    loadEnvFile(WORKING_DIR_ENV_FILE);
}

const apiKey = process.env.HUB_API_KEY?.trim() ?? "";

export const failureConfig = {
    apiKey,
    task: "failure",
    verifyUrl: process.env.VERIFY_ENDPOINT?.trim() || "https://hub.ag3nts.org/verify",
    dataUrl: `https://hub.ag3nts.org/data/${apiKey}/failure.log`,
    mainModel: resolveModelForProvider(process.env.FAILURE_AGENT_MODEL?.trim() || "gpt-4.1-mini"),
    subagentModel: resolveModelForProvider(process.env.FAILURE_AGENT_SUBAGENT_MODEL?.trim() || "gpt-4.1-mini"),
    maxAttempts: Number(process.env.FAILURE_AGENT_MAX_ATTEMPTS ?? 8),
    chunkCount: Number(process.env.FAILURE_AGENT_CHUNK_COUNT ?? 6),
    maxAnswerTokens: Number(process.env.FAILURE_AGENT_MAX_TOKENS ?? 1500),
    maxOutputTokens: Number(process.env.FAILURE_AGENT_MAX_OUTPUT_TOKENS ?? 4096),
    subagentMaxEvents: Number(process.env.FAILURE_AGENT_SUBAGENT_MAX_EVENTS ?? 12),
    debugArtifacts: (process.env.FAILURE_AGENT_DEBUG_ARTIFACTS?.trim() || "true") === "true",
    projectDir: PROJECT_DIR,
    logsDir: path.join(PROJECT_DIR, "logs"),
    artifactsDir: path.join(PROJECT_DIR, "logs", "artifacts")
};

if (!failureConfig.apiKey) {
    throw new Error("HUB_API_KEY environment variable is not set");
}
