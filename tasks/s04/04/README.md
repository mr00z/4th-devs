# S04E04 Filesystem Agent

Agentic solution for the `filesystem` task from lesson S04E04.

## What it does

- reads `natan_notes` via the local `files-mcp`
- uses a delegated two-specialist workflow:
  - `notes_extractor`
  - `filesystem_architect`
- validates and normalizes extracted knowledge deterministically
- writes the virtual filesystem through `/verify`
- prints the flag and saves timestamped logs

## Run

```bash
npm install
npm run start
```

## Environment

Uses the repository root `.env` file and expects:

- `HUB_API_KEY`
- `VERIFY_URL` optional, defaults to `https://hub.ag3nts.org/verify`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
- `CHAT_BASE_URL` optional
- `CHAT_MODEL` optional
