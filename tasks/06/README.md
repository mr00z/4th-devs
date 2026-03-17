# 06 Railway Object Classifier

Full LLM-powered agent that classifies railway objects via the hub.ag3nts.org API. Reactor-related objects must be classified as NEU (not DNG).

## Run

```bash
cd tasks/06
npm install
npm start
```

## Required Setup

1. Copy `env.example` to `.env` in the repo root.
2. Set `HUB_API_KEY` in `.env`
3. Set `OPENAI_API_KEY` or `OPENROUTER_API_KEY` in `.env`

## What It Does

1. Connects to MCP file server and loads native tools
2. Agent fetches CSV data from `https://hub.ag3nts.org/data/<HUB_API_KEY>/categorize.csv`
3. Classifies each object by sending prompts to the classifier API at `https://hub.ag3nts.org/verify`
4. **Key Rule**: Reactor-related objects (containing "reactor", "fuel cassette", "thorium", etc.) must be classified as NEU
5. Handles classifier token limit (100 tokens) with reset mechanism
6. Optimized for cache efficiency - sequential processing, cached CSV data
7. Captures and logs the `{FLG:<SECRET>}` when all objects are classified correctly

## Native Tools

- `classifier_fetch_csv` - Fetch CSV data from hub
- `classifier_send_prompt` - Send classification prompt to classifier
- `classifier_reset` - Reset classifier context when limit reached
- `classifier_get_status` - Get current progress
- `classifier_check_reactor` - Check if object is reactor-related

## Architecture

- Full LLM agent that orchestrates classification workflow
- Cache-optimized sequential processing
- Token budget tracking with cache discount (50% off cached tokens)
- Rate limiting with retry logic
- MCP integration for file logging

## Token Budget

- Total: 1.5 PP for 10 queries
- Input: 0.02 PP per 10 tokens
- Cache: 0.01 PP per 10 tokens (50% discount!)
- Output: 0.02 PP per 10 tokens
