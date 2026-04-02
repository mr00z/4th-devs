# Windpower CLI (`s04/02`)

Deterministic TypeScript Node.js CLI for task `windpower`.

## What it does

1. Calls `start` to open service window.
2. In parallel requests `documentation`, `weather`, `powerplantcheck`.
3. Uses one shared `getResult` consumer (`ResultQueue`) for all async responses.
4. Detects storm windows and major-storm follow-up protection windows.
5. Finds earliest safe production slot that can cover `powerDeficitKw`.
6. Requests unlock codes for all config points via `unlockCodeGenerator`.
7. Submits one batch `config`.
8. Executes `turbinecheck` before `done`.
9. Prints `{FLG:...}` when returned.

## Run

```bash
npm install
npm run start
```

## Optional env overrides

- `WINDPOWER_TASK_NAME` (default: `windpower`)
- `WINDPOWER_TIMEOUT_MS` (default: `4000`)
- `WINDPOWER_RETRY_COUNT` (default: `2`)
- `WINDPOWER_POLL_INTERVAL_MS` (default: `250`)
- `WINDPOWER_SERVICE_WINDOW_MS` (default: `40000`)
- `WINDPOWER_DEADLINE_BUFFER_MS` (default: `2000`)

Uses root `.env` (`../../../.env`) for `HUB_API_KEY` and optional `VERIFY_URL`.

## Logs

- Console logs are timestamped (ISO datetime) and compact.
- Detailed logs are appended to `logs/windpower-YYYY-MM-DD.log`.
