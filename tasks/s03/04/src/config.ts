// @ts-expect-error - root config is untyped JS
import { AI_API_KEY, RESPONSES_API_ENDPOINT, EXTRA_API_HEADERS, resolveModelForProvider } from '../../../../config.js';

export const hubApiKey = process.env.HUB_API_KEY?.trim() ?? '';
export const verifyUrl = process.env.VERIFY_URL?.trim() || 'https://hub.ag3nts.org/verify';
export const port = Number.parseInt(process.env.PORT?.trim() || '3000', 10);
export const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim() || `http://localhost:${port}`;
export const verifyOnStartup = process.env.VERIFY_ON_STARTUP?.trim().toLowerCase() === 'true';
export const responsesApiEndpoint = String(RESPONSES_API_ENDPOINT);
export const extraApiHeaders = (EXTRA_API_HEADERS as Record<string, string>) ?? {};
export const aiApiKey = String(AI_API_KEY || '');
export const negotiationsModel = resolveModelForProvider(
  process.env.NEGOTIATIONS_MODEL?.trim() || 'gpt-4.1-mini',
) as string;

export const minOutputBytes = 4;
export const maxOutputBytes = 500;

if (!hubApiKey) {
  console.error('\x1b[31mError: HUB_API_KEY is not set\x1b[0m');
  console.error('       Add HUB_API_KEY=your-key to the root .env file');
  process.exit(1);
}

if (!aiApiKey) {
  console.error('\x1b[31mError: AI API key is not set\x1b[0m');
  console.error('       Configure OPENAI_API_KEY or OPENROUTER_API_KEY in root .env file');
  process.exit(1);
}
