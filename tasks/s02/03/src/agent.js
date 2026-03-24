import { verifyLogs } from './api.js';
import { extractVerifierDirectives, shouldRetry } from './analysis/feedback.js';
import { mergeCandidates } from './analysis/merge-candidates.js';
import { compressEventsToBudget } from './analysis/compress.js';
import { analyzeChunk } from './analysis/analyze-chunk.js';
import { failureConfig } from './config.js';
import log, { writeArtifact } from './helpers/logger.js';
import { fetchFailureLog } from './logs/fetch.js';
import { chunkByLines } from './logs/chunk.js';
import { parseFailureLog } from './logs/parse.js';
import { createMcpClient, closeMcpClient, inspectFailureLogViaMcp } from './mcp/client.js';

const asHintText = (hints) => hints.join(' ').toLowerCase();

const shouldExpand = (hints) => /too short|missing|add more|not enough|do not know what happened to|still unclear/.test(asHintText(hints));

const mergeRequiredComponents = (current, next) => {
    const merged = new Set([...(current || []), ...(next || [])]);
    return [...merged];
};

export const run = async () => {
    await log.start('run_start');
    await log.data('config', {
        verifyUrl: failureConfig.verifyUrl,
        dataUrl: failureConfig.dataUrl,
        chunkSizeLines: failureConfig.chunkSizeLines,
        chunkOverlapLines: failureConfig.chunkOverlapLines,
        answerTokenLimit: failureConfig.answerTokenLimit,
        maxAttempts: failureConfig.maxAttempts,
        provider: failureConfig.provider || 'none',
        model: failureConfig.model,
    });
    await log.trace('runtime.flags', {
        logVerbose: failureConfig.logVerbose,
        logPreviewChars: failureConfig.logPreviewChars,
    });

    const rawLog = await fetchFailureLog();
    await log.trace('failure_log.raw_preview', rawLog.slice(0, failureConfig.logPreviewChars));
    const entries = parseFailureLog(rawLog);
    await log.data('failure_log_parsed', { lineCount: entries.length });
    await log.trace(
        'failure_log.first_entries',
        entries.slice(0, 5).map((entry) => ({
            id: entry.id,
            date: entry.date,
            time: entry.time,
            severity: entry.severity,
            component: entry.component,
            message: entry.message,
        })),
    );

    let mcpClient = null;
    try {
        mcpClient = await createMcpClient();
        const mcpInspection = await inspectFailureLogViaMcp(mcpClient);
        await writeArtifact('mcp-inspection.json', mcpInspection || {});
        await log.success('mcp_file_tools_connected');
    } catch (error) {
        await log.warn(
            `MCP inspection unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const chunks = chunkByLines(
        entries,
        failureConfig.chunkSizeLines,
        failureConfig.chunkOverlapLines,
    );
    await log.data(
        'chunks_created',
        chunks.map((chunk) => ({
            id: chunk.id,
            startLineId: chunk.startLineId,
            endLineId: chunk.endLineId,
            lineCount: chunk.lines.length,
            overlap: chunk.overlap,
        })),
    );

    let hints = [];
    let requiredComponents = [];
    let verification = null;
    const aggregateByLineId = new Map();

    try {
        for (let attempt = 1; attempt <= failureConfig.maxAttempts; attempt += 1) {
            await log.start(`attempt ${attempt}/${failureConfig.maxAttempts}`);

            const analyses = await Promise.all(
                chunks.map((chunk) =>
                    analyzeChunk({
                        chunk,
                        hints,
                        requiredComponents,
                    }),
                ),
            );

            await writeArtifact(`attempt-${attempt}-analyses.json`, analyses);
            await log.trace(
                'attempt.analyses.summary',
                analyses.map((analysis, index) => ({
                    chunkId: chunks[index]?.id,
                    selected: Array.isArray(analysis?.events) ? analysis.events.length : 0,
                })),
            );

            const candidates = mergeCandidates({
                analyses,
                entries,
                hints,
                maxEvents: failureConfig.maxEventsPerAttempt,
                requiredComponents,
            });
            await log.data('candidates_merged', {
                attempt,
                mergedCount: candidates.length,
            });
            await log.trace(
                'candidates.top',
                candidates.slice(0, 10).map((item) => ({
                    id: item.id,
                    score: item.score,
                    severity: item.severity,
                    component: item.component,
                    rewrite: item.rewrite,
                })),
            );

            for (const candidate of candidates) {
                const existing = aggregateByLineId.get(candidate.id);
                if (!existing || existing.score < candidate.score) {
                    aggregateByLineId.set(candidate.id, candidate);
                }
            }
            await log.data('aggregate_candidates', {
                attempt,
                aggregateCount: aggregateByLineId.size,
            });

            const selectedSource = shouldExpand(hints)
                ? [...aggregateByLineId.values()].sort((a, b) => b.score - a.score || a.id - b.id)
                : candidates;
            await log.trace('selected_source.mode', shouldExpand(hints) ? 'aggregate' : 'attempt-only');

            const budgeted = compressEventsToBudget({
                events: selectedSource,
                maxTokens: failureConfig.answerTokenLimit,
                requiredComponents,
            });

            await writeArtifact(`attempt-${attempt}-selected.json`, budgeted.selectedEvents);
            await writeArtifact(`attempt-${attempt}-payload.txt`, budgeted.logs);

            await log.data('payload_prepared', {
                attempt,
                selectedEvents: budgeted.selectedEvents.length,
                estimatedTokens: budgeted.estimatedTokens,
            });
            await log.trace('payload.preview', budgeted.logs.slice(0, failureConfig.logPreviewChars));

            verification = await verifyLogs(budgeted.logs);
            await writeArtifact(`attempt-${attempt}-verify.json`, verification);
            await log.data('verify_result', {
                attempt,
                status: verification.status,
                ok: verification.ok,
                hasFlag: Boolean(verification.flag),
            });
            await log.trace('verify.response.preview', verification.text.slice(0, failureConfig.logPreviewChars));

            if (verification.flag) {
                await log.success('flag_received');
                return {
                    flag: verification.flag,
                    attempts: attempt,
                    selectedEvents: budgeted.selectedEvents.length,
                    estimatedTokens: budgeted.estimatedTokens,
                };
            }

            const directives = extractVerifierDirectives(verification);
            hints = [...new Set([...(hints || []), ...(directives.hints || [])])];
            requiredComponents = mergeRequiredComponents(requiredComponents, directives.requiredComponents);
            await log.data('verifier_hints', { attempt, hints });
            await log.data('verifier_directives', { attempt, requiredComponents });

            if (!shouldRetry({ verification, attempt, maxAttempts: failureConfig.maxAttempts })) {
                break;
            }
        }
    } finally {
        await closeMcpClient(mcpClient);
    }

    await log.warn('finished_without_flag');
    return {
        flag: null,
        attempts: failureConfig.maxAttempts,
        hints,
        verification: verification
            ? {
                ok: verification.ok,
                status: verification.status,
                text: verification.text,
            }
            : null,
    };
};

