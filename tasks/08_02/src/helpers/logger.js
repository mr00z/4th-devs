import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { failureConfig } from '../config.js';

const colors = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

let queue = Promise.resolve();

const timestamp = () => new Date().toISOString();

const stringify = (value) => {
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const preview = (value, maxChars = failureConfig.logPreviewChars) => {
    const rendered = stringify(value);
    if (rendered.length <= maxChars) {
        return rendered;
    }

    return `${rendered.slice(0, maxChars)}…`;
};

const persist = (level, label, value) => {
    const line = `[${timestamp()}] [${level}] ${label} ${stringify(value)}\n`;
    queue = queue
        .then(async () => {
            await mkdir(failureConfig.logsDir, { recursive: true });
            await appendFile(failureConfig.logFilePath, line, 'utf8');
        })
        .catch(() => { });

    return queue;
};

const print = (label, value, color) => {
    console.log(`${color}${label}${colors.reset} ${value}`);
};

const write = (level, label, value, color) => {
    const rendered = stringify(value);
    print(label, rendered, color);
    void persist(level, label, rendered);
};

const box = (text) => {
    const lines = text.split('\n');
    const width = Math.max(...lines.map((line) => line.length), 0);
    const border = '═'.repeat(width + 2);
    const rendered = [
        `╔${border}╗`,
        ...lines.map((line) => `║ ${line.padEnd(width, ' ')} ║`),
        `╚${border}╝`,
    ].join('\n');

    console.log(`${colors.blue}${rendered}${colors.reset}`);
    void persist('box', '[box]', rendered);
};

export const writeArtifact = async (name, value) => {
    await mkdir(failureConfig.artifactsDir, { recursive: true });
    const payload = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    await writeFile(`${failureConfig.artifactsDir}/${name}`, payload, 'utf8');
    if (failureConfig.logVerbose) {
        write('artifact', '[artifact]', `${name} (${payload.length} chars)`, colors.dim);
    }
};

export default {
    async reset() {
        queue = Promise.resolve();
        await mkdir(failureConfig.logsDir, { recursive: true });
        await mkdir(failureConfig.artifactsDir, { recursive: true });
        await writeFile(failureConfig.logFilePath, '', 'utf8');
    },
    box,
    info(message) {
        write('info', '[info]', message, colors.cyan);
    },
    start(message) {
        write('start', '[run]', message, colors.yellow);
    },
    success(message) {
        write('success', '[ok]', message, colors.green);
    },
    warn(message) {
        write('warn', '[warn]', message, colors.magenta);
    },
    data(label, value) {
        write('data', `[data] ${label}`, value, colors.dim);
    },
    trace(label, value) {
        if (!failureConfig.logVerbose) {
            return;
        }

        const rendered = preview(value);
        write('trace', `[trace] ${label}`, rendered, colors.blue);
    },
    error(message, details = '') {
        write('error', '[err]', `${message}${details ? `: ${details}` : ''}`, colors.red);
    },
    flush() {
        return queue;
    },
};

