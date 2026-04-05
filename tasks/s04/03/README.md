# Domatowo Agent CLI (`s04/03`)

AI agent for the `domatowo` rescue mission task from lesson S04E03.

## What it does

1. Loads configuration from root `.env` file.
2. Calls `help` to understand available actions and API schema.
3. Fetches the city map using `getMap`.
4. Parses terrain, identifies roads and buildings, ranks candidate tiles.
5. Creates minimal viable units (transporter + scouts) to conserve action points.
6. Executes a guided search:
   - Drives transporter to road positions near high-value candidates.
   - Disembarks scouts for final approach.
   - Inspects tiles and fetches/logs analysis.
7. Calls helicopter immediately upon confirmation.
8. Extracts and prints the flag.

## Run

```bash
npm install
npm run start
```

## Environment Configuration

Uses root `.env` (at `../../../.env`) for:

- `HUB_API_KEY` - required API key
- `VERIFY_URL` - optional, defaults to `https://hub.ag3nts.org/verify`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY` - for agent loop
- `CHAT_BASE_URL` - optional API base URL
- `CHAT_MODEL` - optional model name

Optional overrides:

- `DOMATOWO_TIMEOUT_MS` - request timeout (default: 8000)
- `DOMATOWO_RETRY_COUNT` - retry attempts (default: 2)
- `DOMATOWO_MAX_TURNS` - agent loop limit (default: 30)

## Logs

- Console logs are timestamped (ISO datetime) and compact.
- Detailed logs are appended to `logs/domatowo-YYYY-MM-DD.log`.

## Architecture

- Deterministic core: map, mission state, planner, log analysis
- Agentic loop: validated tool calls with LLM assistance for prioritization
- Strict guardrails: AP budget, road constraints, helicopter preconditions
