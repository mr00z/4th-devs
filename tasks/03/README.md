# Package Agent Server

Simple HTTP server that provides an agent with access to package management tools.

## Endpoints

### POST /

Main endpoint for interacting with the agent.

**Request:**
```json
{
  "sessionID": "dowolny-id-sesji",
  "msg": "Dowolna wiadomość wysłana przez operatora systemu"
}
```

**Response:**
```json
{
  "msg": "Tutaj odpowiedź dla operatora"
}
```

### GET /health

Health check endpoint.

## Tools Available to LLM

- `check_package` - Check package status by package ID
- `redirect_package` - Redirect a package to a different destination

## Setup

1. Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

2. Set required environment variables in `.env`:
   - `OPENAI_API_KEY` or `OPENROUTER_API_KEY` - for LLM access
   - `HUB_API_KEY` - for package API access
   - `SYSTEM_PROMPT` - system prompt for the LLM (optional)

3. Install dependencies and run:
```bash
bun install
bun dev
```

## Session Management

Sessions are stored in memory with a 24-hour TTL. Each `sessionID` maintains its own conversation history which is passed to the LLM on each request.
