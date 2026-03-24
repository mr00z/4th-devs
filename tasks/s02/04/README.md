# Mailbox Search Agent (Task 09)

An AI agent that searches a remote mailbox via the zmail API to extract specific information and submit it for verification.

## Setup

1. **Dependencies**: Install with `npm install`
2. **API Key**: Add `HUB_API_KEY=your-key` to the root `.env` file (same location as other task projects)
3. **OpenAI**: Ensure `OPENAI_API_KEY` or `OPENROUTER_API_KEY` is set in root `.env`

## Usage

```bash
npm start          # Run once
npm run dev        # Watch mode for development
```

## What the Agent Does

1. **Searches** the mailbox for emails from `proton.me` domain
2. **Extracts** three pieces of information:
   - `date`: When security department plans to attack (YYYY-MM-DD format)
   - `password`: Employee system password still in the mailbox
   - `confirmation_code`: Security ticket code (SEC- + 32 chars = 36 total)
3. **Submits** findings to verification endpoint
4. **Retries** if verification fails, using feedback to adjust approach

## Architecture

- **TypeScript** with tsx runner
- **OpenAI SDK** for LLM chat completions with tool use
- **5 tools**: search_mailbox, get_inbox, get_thread, get_messages, submit_answer
- **Colored logging** for all operations
- **Single-agent loop** (no sub-agents needed)

## Files

- `src/config.ts` - OpenAI client and HUB_API_KEY from root env
- `src/tools.ts` - API wrappers for zmail and verify endpoints
- `src/agent.ts` - Main agent loop with system prompt
- `src/logger.ts` - Colored terminal logging
- `src/index.ts` - Entry point and result display

## Expected Output

If successful, the agent will output a flag in format `{FLG:<FLAG_HERE>}`. If verification fails, it will show the API feedback and retry.
