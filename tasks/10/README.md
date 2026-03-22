# Drone Dam Agent (Task 10)

An AI agent that analyzes a target image, identifies the 3x3 sector containing the dam, composes the minimal drone instructions needed to destroy that sector, and keeps retrying verification until it receives a flag.

## Setup

1. **Dependencies**: Install with `npm install`
2. **API Key**: Add `HUB_API_KEY=your-key` to the root `.env` file
3. **OpenAI**: Ensure `OPENAI_API_KEY` or `OPENROUTER_API_KEY` is set in root `.env`

## Usage

```bash
npm start
npm run dev
```

## What the Agent Does

1. Analyzes the provided drone image
2. Finds the row and column of the 3x3 rectangle containing the dam
3. Composes only the necessary drone instructions
4. Sends them to `https://hub.ag3nts.org/verify`
5. Retries using API feedback until a flag is returned

## Files

- `src/config.ts` - OpenAI client and shared env loading
- `src/vision.ts` - Vision request helper
- `src/tools.ts` - Image analysis and verification tools
- `src/agent.ts` - Main agent loop and prompt
- `src/logger.ts` - Console/file logger
- `src/index.ts` - Entrypoint
