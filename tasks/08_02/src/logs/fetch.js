import { mkdir, writeFile } from 'node:fs/promises';
import { failureConfig } from '../config.js';
import log from '../helpers/logger.js';

export const fetchFailureLog = async () => {
    log.start('download_failure_log');
    log.trace('failure_log.request', {
        url: failureConfig.dataUrl,
    });

    const response = await fetch(failureConfig.dataUrl);
    const text = await response.text();

    log.trace('failure_log.response', {
        status: response.status,
        ok: response.ok,
        chars: text.length,
        preview: text.slice(0, failureConfig.logPreviewChars),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch failure log (${response.status})`);
    }

    await mkdir(failureConfig.workspaceDir, { recursive: true });
    await writeFile(failureConfig.localFailureLogPath, text, 'utf8');
    log.success('failure_log_saved');
    log.trace('failure_log.path', failureConfig.localFailureLogPath);
    return text;
};

