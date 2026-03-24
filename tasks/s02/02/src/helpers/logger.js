import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const color = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m"
};

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TASK_DIR = path.resolve(HELPERS_DIR, "../../");
const LOG_DIR = path.join(TASK_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "electricity.log");
let writeQueue = Promise.resolve();

const timestamp = () => new Date().toISOString();

const stringify = (value) => {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const persist = (level, label, value) => {
    const line = `[${timestamp()}] [${level}] ${label} ${stringify(value)}\n`;
    writeQueue = writeQueue
        .then(async () => {
            await mkdir(LOG_DIR, { recursive: true });
            await appendFile(LOG_FILE, line, "utf8");
        })
        .catch(() => { });

    return writeQueue;
};

const print = (label, value, tone = color.cyan) => {
    console.log(`${tone}${label}${color.reset} ${value}`);
};

const write = (level, label, value, tone) => {
    const rendered = stringify(value);
    print(label, rendered, tone);
    void persist(level, label, rendered);
};

const formatBox = (message) => {
    const lines = message.split("\n");
    const width = Math.max(...lines.map((line) => line.length), 0);
    const border = "═".repeat(width + 2);

    return [
        `╔${border}╗`,
        ...lines.map((line) => `║ ${line.padEnd(width, " ")} ║`),
        `╚${border}╝`
    ].join("\n");
};

export default {
    async reset() {
        writeQueue = Promise.resolve();
        await mkdir(LOG_DIR, { recursive: true });
        await writeFile(LOG_FILE, "", "utf8");
    },
    box(message) {
        const rendered = formatBox(message);
        console.log(`${color.blue}${rendered}${color.reset}`);
        void persist("box", "[box]", rendered);
    },
    info(message) {
        write("info", "[info]", message, color.cyan);
    },
    start(message) {
        write("start", "[run]", message, color.yellow);
    },
    success(message) {
        write("success", "[ok]", message, color.green);
    },
    warn(message) {
        write("warn", "[warn]", message, color.magenta);
    },
    debug(scope, value) {
        write("debug", `[dbg] ${scope}`, value, color.dim);
    },
    step(step, total, message) {
        write("step", `[step ${step}/${total}]`, message, color.blue);
    },
    data(label, value) {
        write("data", `[data] ${label}`, value, color.dim);
    },
    error(message, details = "") {
        write("error", "[err]", `${message}${details ? `: ${details}` : ""}`, color.red);
    },
    flush() {
        return writeQueue;
    }
};
