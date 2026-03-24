import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TASK_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TASK_DIR, "../../");
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

if (!process.env.HUB_API_KEY && WORKING_DIR_ENV_FILE !== ROOT_ENV_FILE) {
    loadEnvFile(WORKING_DIR_ENV_FILE);
}

const hubApiKey = process.env.HUB_API_KEY?.trim() ?? "";

export const puzzleConfig = {
    apiKey: hubApiKey,
    task: "electricity",
    dataUrl: `https://hub.ag3nts.org/data/${hubApiKey}/electricity.png`,
    verifyUrl: process.env.VERIFY_ENDPOINT?.trim() || "https://hub.ag3nts.org/verify",
    targetImagePath: path.resolve(TASK_DIR, "../assets/target-electricity.png"),
    liveImagePath: path.resolve(TASK_DIR, "../workspace/live/electricity.png"),
    croppedLiveImagePath: path.resolve(TASK_DIR, "../workspace/live/electricity-cropped.png"),
    croppedTargetImagePath: path.resolve(TASK_DIR, "../workspace/live/target-cropped.png"),
    mainModel: process.env.OPENAI_MAIN_MODEL?.trim() || "gpt-5.2",
    visionModel: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.4",
    useTargetVision: (process.env.ELECTRICITY_USE_TARGET_VISION?.trim() || "false") === "true",
    checkpointEveryMoves: Number(process.env.ELECTRICITY_VERIFY_EVERY ?? 0),
    maxMoves: Number(process.env.ELECTRICITY_MAX_MOVES ?? 50),
    crop: {
        left: Number(process.env.ELECTRICITY_CROP_LEFT ?? 220),
        top: Number(process.env.ELECTRICITY_CROP_TOP ?? 92),
        width: Number(process.env.ELECTRICITY_CROP_WIDTH ?? 324),
        height: Number(process.env.ELECTRICITY_CROP_HEIGHT ?? 302)
    }
};

if (!puzzleConfig.apiKey) {
    throw new Error("HUB_API_KEY environment variable is not set");
}
