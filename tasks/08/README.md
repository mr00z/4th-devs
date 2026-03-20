# 08_02 Failure Logs Agent

Standalone agent for the `failure` task.

## What it does

1. Downloads failure logs from the hub endpoint.
2. Saves raw logs to `workspace/failure.log`.
3. Uses MCP file tools (`mcp/files-mcp`) to inspect saved logs.
4. Parses and chunks logs by **lines** with overlap.
5. Analyzes chunks to select breakdown-relevant events.
6. Formats final output as one event per line.
7. Compresses selection to stay within 1500 token budget.
8. Sends verify requests in a retry loop until a flag appears or attempts are exhausted.

## Run

From repository root:

```bash
node tasks/08_02/app.js
```

or:

```bash
npm run --prefix tasks/08_02 start
```

## Required environment

- `HUB_API_KEY`

## Optional environment

- `OPENAI_API_KEY` (for model-based chunk analysis)
- `OPENROUTER_API_KEY` (alternative provider)
- `AI_PROVIDER=openai|openrouter`
- `VERIFY_ENDPOINT` (defaults to `https://hub.ag3nts.org/verify`)
- `FAILURE_MAX_ATTEMPTS` (default `12`)
- `FAILURE_CHUNK_SIZE` (default `120` lines)
- `FAILURE_CHUNK_OVERLAP` (default `24` lines)
- `FAILURE_MAX_EVENTS` (default `220`)
- `FAILURE_MAIN_MODEL`
- `FAILURE_COMPRESSION_MODEL`

## Artifacts

- Raw log: `workspace/failure.log`
- Attempt artifacts: `workspace/artifacts/`
- Runtime log file: `logs/failure-agent.log`

## Output constraints

The agent preserves the required answer shape:

```json
{
  "apikey": "<HUB_API_KEY>",
  "task": "failure",
  "answer": {
    "logs": "..."
  }
}
```

And enforces:

- one event per output line
- date format `YYYY-MM-DD`
- time format `HH:MM` (or equivalent normalized)
- preserved timestamp + severity + component id
- hard cap of 1500 estimated tokens

