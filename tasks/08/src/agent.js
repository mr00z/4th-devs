import { fetchFailureLog, verifyLogs } from "./api.js";
import { failureConfig } from "./config.js";
import { extractVerifierHints, shouldRetry } from "./feedback.js";
import log, { writeArtifact } from "./helpers/logger.js";
import { chunkLogEntries } from "./logs/chunk.js";
import { parseFailureLog } from "./logs/parse.js";
import { expandCandidateContext, mergeCandidates, rankCandidates, stringifyLogs } from "./merge.js";
import { MAIN_AGENT_NOTES } from "./prompts.js";
import { runParallelSubagents } from "./subagents/run-parallel.js";
import { estimateTokens, fitEventsWithinBudget } from "./token-budget.js";

export const run = async () => {
    await log.start("run_start");
    await log.info(MAIN_AGENT_NOTES);

    const rawLog = await fetchFailureLog();
    const entries = parseFailureLog(rawLog);
    await log.data("failure_log_fetched", { lineCount: entries.length });

    const chunks = chunkLogEntries(entries, failureConfig.chunkCount);
    await log.data("chunks_created", chunks.map((chunk) => ({
        id: chunk.id,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        size: chunk.lines.length
    })));

    let verifierHints = [];
    let lastVerification = null;
    let aggregateCandidates = [];
    let best = {
        logs: "",
        estimatedTokens: Number.POSITIVE_INFINITY,
        selectedCount: 0
    };

    for (let attempt = 1; attempt <= failureConfig.maxAttempts; attempt += 1) {
        await log.start(`attempt ${attempt}/${failureConfig.maxAttempts}`);
        const results = await runParallelSubagents({ chunks, attempt, verifierHints });
        await writeArtifact(`attempt-${attempt}-subagents.json`, results);

        const merged = mergeCandidates(results);
        if (merged.length > 0) {
            aggregateCandidates = mergeCandidates([{ events: aggregateCandidates }, { events: merged }]);
        }
        await log.data("candidates_merged", {
            attempt,
            totalCandidates: merged.length,
            aggregateCandidates: aggregateCandidates.length
        });

        const sourceCandidates = verifierHints.some((hint) => /too short|add more lines/i.test(hint))
            ? aggregateCandidates
            : merged;

        const ranked = rankCandidates(sourceCandidates, verifierHints);
        const expanded = verifierHints.some((hint) => /too short|add more lines/i.test(hint))
            ? expandCandidateContext(ranked)
            : ranked;
        const budgeted = fitEventsWithinBudget(expanded, failureConfig.maxAnswerTokens);
        const logs = stringifyLogs(budgeted.selected);
        const estimatedTokens = estimateTokens(logs);

        await log.data("token_budget_checked", {
            attempt,
            candidateCount: ranked.length,
            expandedCount: expanded.length,
            selectedCount: budgeted.selected.length,
            estimatedTokens,
            maxTokens: failureConfig.maxAnswerTokens,
            fits: estimatedTokens <= failureConfig.maxAnswerTokens
        });

        if (estimatedTokens < best.estimatedTokens && logs) {
            best = {
                logs,
                estimatedTokens,
                selectedCount: budgeted.selected.length
            };
        }

        await writeArtifact(`attempt-${attempt}-payload.txt`, logs);

        const verification = await verifyLogs(logs);
        lastVerification = verification;

        await log.data("verify_response_received", {
            attempt,
            ok: verification.ok,
            status: verification.status,
            hasFlag: Boolean(verification.flag)
        });

        if (verification.flag) {
            await log.success("flag_received");
            return {
                flag: verification.flag,
                attempts: attempt,
                selectedCount: budgeted.selected.length,
                estimatedTokens
            };
        }

        verifierHints = extractVerifierHints(verification);
        await log.data("retry_scheduled", {
            attempt,
            verifierHints
        });

        if (!shouldRetry(verification, attempt, failureConfig.maxAttempts)) {
            break;
        }
    }

    await log.warn("run_finished_without_flag");
    return {
        flag: null,
        attempts: failureConfig.maxAttempts,
        best,
        verifierHints,
        verification: lastVerification ? {
            ok: lastVerification.ok,
            status: lastVerification.status,
            text: lastVerification.text
        } : null
    };
};
