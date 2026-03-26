import express, { type Request, type Response } from 'express';
import { hubApiKey, port, publicBaseUrl, verifyOnStartup, verifyUrl } from './config.js';
import { logError, logInfo } from './logger.js';
import { createToolService } from './tools.js';

interface VerifyBody {
  apikey: string;
  task: 'negotiations';
  answer: {
    tools: Array<{
      URL: string;
      description: string;
    }>;
  };
}

const app = express();
app.use(express.json({ limit: '64kb' }));

const tools = createToolService();
const toolUrl = `${publicBaseUrl}/api/find-city`;

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post('/api/find-city', async (req: Request, res: Response) => {
  try {
    const result = await tools.handleFindCity(req.body as { params?: unknown });
    res.status(200).json(result);
  } catch (error) {
    logError('Tool endpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(200).json({ output: 'Błąd przetwarzania. Spróbuj ponownie.' });
  }
});

async function registerToolsOnStartup(): Promise<void> {
  const payload: VerifyBody = {
    apikey: hubApiKey,
    task: 'negotiations',
    answer: {
      tools: [
        {
          URL: toolUrl,
          description:
            'Wyszukuje miasta dla produktu opisanego naturalnym językiem w polu params. Przyjmuje JSON {"params":"opis produktu"}. Zwraca krótki tekst z najlepszym dopasowaniem i listą miast.',
        },
      ],
    },
  };

  logInfo('Sending startup verify request', { verifyUrl, toolUrl });

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  logInfo('Verify response received', {
    status: response.status,
    ok: response.ok,
    bodyPreview: raw.slice(0, 300),
  });

  if (!response.ok) {
    throw new Error(`Verify failed: ${response.status} ${response.statusText} ${raw}`);
  }
}

app.listen(port, () => {
  logInfo(`Negotiations tools API listening on http://localhost:${port}`);

  if (!verifyOnStartup) {
    logInfo('Startup verify request is disabled (set VERIFY_ON_STARTUP=true to enable).', {
      verifyUrl,
      toolUrl,
    });
    return;
  }

  registerToolsOnStartup().catch((error) => {
    logError('Startup verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
