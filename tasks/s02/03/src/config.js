import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TASK_ROOT = path.resolve(__dirname, '..');

const HUB_API_KEY = process.env.HUB_API_KEY?.trim() ?? '';

if (!HUB_API_KEY) {
    throw new Error('HUB_API_KEY is required');
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() ?? '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? '';
const providerFromEnv = process.env.AI_PROVIDER?.trim().toLowerCase() ?? '';

const provider = providerFromEnv || (OPENAI_API_KEY ? 'openai' : OPENROUTER_API_KEY ? 'openrouter' : null);

export const failureConfig = {
    taskRoot: TASK_ROOT,
    workspaceDir: path.join(TASK_ROOT, 'workspace'),
    artifactsDir: path.join(TASK_ROOT, 'workspace', 'artifacts'),
    logsDir: path.join(TASK_ROOT, 'logs'),
    logFilePath: path.join(TASK_ROOT, 'logs', 'failure-agent.log'),
    mcpConfigPath: path.join(TASK_ROOT, 'mcp.json'),
    localFailureLogPath: path.join(TASK_ROOT, 'workspace', 'failure.txt'),

    task: 'failure',
    verifyUrl: process.env.VERIFY_ENDPOINT?.trim() || 'https://hub.ag3nts.org/verify',
    dataUrl: `https://hub.ag3nts.org/data/${HUB_API_KEY}/failure.log`,
    hubApiKey: HUB_API_KEY,

    answerTokenLimit: 1500,
    maxAttempts: Number(process.env.FAILURE_MAX_ATTEMPTS || 12),
    chunkSizeLines: Number(process.env.FAILURE_CHUNK_SIZE || 120),
    chunkOverlapLines: Number(process.env.FAILURE_CHUNK_OVERLAP || 24),
    maxEventsPerAttempt: Number(process.env.FAILURE_MAX_EVENTS || 220),

    model: process.env.FAILURE_MAIN_MODEL?.trim() || process.env.OPENAI_MAIN_MODEL?.trim() || 'gpt-5-mini',
    modelCompression:
        process.env.FAILURE_COMPRESSION_MODEL?.trim()
        || process.env.OPENAI_MAIN_MODEL?.trim()
        || 'gpt-5-mini',
    maxOutputTokens: Number(process.env.FAILURE_MAX_OUTPUT_TOKENS || 2000),
    logVerbose: process.env.FAILURE_LOG_VERBOSE?.trim() !== 'false',
    logPreviewChars: Number(process.env.FAILURE_LOG_PREVIEW_CHARS || 260),

    provider,
    responsesEndpoint:
        provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/responses'
            : 'https://api.openai.com/v1/responses',
    aiApiKey: provider === 'openrouter' ? OPENROUTER_API_KEY : OPENAI_API_KEY,
    extraHeaders:
        provider === 'openrouter'
            ? {
                ...(process.env.OPENROUTER_HTTP_REFERER
                    ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
                    : {}),
                ...(process.env.OPENROUTER_APP_NAME
                    ? { 'X-Title': process.env.OPENROUTER_APP_NAME }
                    : {}),
            }
            : {},
};

export const hasModelAccess = Boolean(failureConfig.aiApiKey && failureConfig.provider);

