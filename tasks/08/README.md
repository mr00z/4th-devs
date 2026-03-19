# Failure Breakdown Agent

Agent for task `failure`.

It fetches the power-plant failure log, splits it into deterministic chunks, runs parallel LLM sub-agents on each chunk, merges the suspected breakdown-related events, enforces the answer budget, and keeps retrying against the verify endpoint until a `{FLG:...}` response is returned or the retry limit is reached.

## Run

```bash
node tasks/08/app.js
```

## Required environment

- `HUB_API_KEY`

## Optional environment

- `FAILURE_AGENT_MODEL=gpt-5.4-mini`
- `FAILURE_AGENT_SUBAGENT_MODEL=gpt-5.4-mini`
- `FAILURE_AGENT_MAX_ATTEMPTS=8`
- `FAILURE_AGENT_CHUNK_COUNT=6`
- `FAILURE_AGENT_MAX_TOKENS=1500`
- `FAILURE_AGENT_DEBUG_ARTIFACTS=true`
- `VERIFY_ENDPOINT=https://hub.ag3nts.org/verify`

## Logging

- Main logs are written to [`tasks/08/logs/agent.log`](tasks/08/logs/agent.log)
- API logs are written to [`tasks/08/logs/api.log`](tasks/08/logs/api.log)
- Debug artifacts can be written to [`tasks/08/logs/artifacts`](tasks/08/logs/artifacts)

## Architecture

- [`tasks/08/src/agent.js`](tasks/08/src/agent.js) orchestrates retries and verification.
- [`tasks/08/src/subagents/run-parallel.js`](tasks/08/src/subagents/run-parallel.js) runs one independent LLM call per chunk via `Promise.all`.
- [`tasks/08/src/merge.js`](tasks/08/src/merge.js) deduplicates and ranks candidate events.
- [`tasks/08/src/token-budget.js`](tasks/08/src/token-budget.js) keeps the final payload under the hard answer limit.
