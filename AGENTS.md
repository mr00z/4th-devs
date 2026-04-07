# AI Devs 4: Builders - Workspace Guide

This repository is a learning workspace for building AI agents. It contains code examples, lesson transcriptions, and task implementations.

## Repository Structure

### Code Examples (Numbered Folders)

Folders prefixed with numbers in the root directory contain runnable code examples:

- `01_XX_*` - Season 1 examples (Lessons 1-5)
- `02_XX_*` - Season 2 examples (Lessons 6-10)
- `03_XX_*` - Season 3 examples (Lessons 11-14)
- `04_XX_*` - Season 4 examples (Lessons 15-18)
- `05_XX_*` - Season 5+ examples (future/bonus)

Each example folder contains its own `package.json` with dependencies and scripts.

### Lessons (`lessons/`)

Lesson transcriptions in Markdown format, organized by season:

```
lessons/
- s01/  # Season 1: Lessons 1-5
- s02/  # Season 2: Lessons 6-10
- s03/  # Season 3: Lessons 11-14
- s04/  # Season 4: Lessons 15-18
```

File naming convention: `s{season}e{episode}-{title}-{id}.md`

### Tasks (`tasks/`)

User-built agent implementations for corresponding lessons:

```
tasks/
- s01/
  - 01/  # Task for Lesson s01e01
  - 02/  # Task for Lesson s01e02
  - 03/  # Task for Lesson s01e03
  - 04/  # Task for Lesson s01e04
  - 05/  # Task for Lesson s01e05
- s02/
  - 01/  # Task for Lesson s02e01
  - 02/  # Task for Lesson s02e02
  - 03/  # Task for Lesson s02e03
  - 04/  # Task for Lesson s02e04
  - 05/  # Task for Lesson s02e05
- s03/
  - 01/  # Task for Lesson s03e01
  - 02/  # Task for Lesson s03e02
  - 03/  # Task for Lesson s03e03
  - 04/  # Task for Lesson s03e04
  - 05/  # Task for Lesson s03e05
- s04/
  - 01/  # Task for Lesson s04e01
  - 02/  # Task for Lesson s04e02
  - 03/  # Task for Lesson s04e03
  - 03_deterministic/  # Variant/extra for s04e03
  - 04/  # Task for Lesson s04e04
```

Each task folder is a self-contained project with its own `package.json`. They all are CTF (Capture The Flag) challenges.

## Environment Configuration

A single `.env` file in the repository root provides configuration for all tasks and examples. Key environment variables:

### Required (choose one)
- `OPENAI_API_KEY` - OpenAI API key
- `OPENROUTER_API_KEY` - OpenRouter API key (recommended)

### Optional (specific lessons)
- `GEMINI_API_KEY` - For multimodal examples (Lesson 4, Lesson 12)
- `REPLICATE_API_TOKEN` - For video generation examples
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` - For graph agents (Lesson 8)
- `RESEND_API_KEY`, `RESEND_FROM` - For email agent examples (Lesson 5)
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` - For observability (Lesson 11)

## Key Files

- `config.js` - Shared configuration for API providers, model selection, and tool definitions
- `package.json` - Root package with all lesson scripts and dependencies
- `mcp/` - MCP (Model Context Protocol) server implementations
- `env.example` - Template for environment variables

## Lesson Topics

| Season | Lessons | Topics |
|--------|---------|--------|
| S01 | 1-5 | Model interaction, structured output, tools, MCP, multimodal, agent architecture |
| S02 | 6-10 | Agentic RAG, chunking, embeddings, graph agents, multi-agent systems |
| S03 | 11-14 | Observability and evaluation, model limitations, contextual feedback, test-based tool building |
| S04 | 15-18 | AI deployments, active collaboration with AI, context-aware collaboration, building a knowledge base |

## Dictionary

- **flag** - The flag is the solution to the task. It is a string that the user needs to find. Its format is `{FLG:...}` where `...` is the actual flag value.

- **verify endpoint** - The verify endpoint is the endpoint that the user needs to call to get the flag. Its URL can be found in `.env` file.

## Notes for AI Assistants

1. **Dependencies**: Check if dependencies are installed before running examples. Each numbered folder has its own `node_modules`.

2. **Environment**: Always reference the root `.env` file. Task folders do not have separate environment files.

3. **Code Style**: Examples use ES modules (`import/export`). The codebase targets Node.js 24+. Prefer TypeScript over JavaScript.

4. **MCP Servers**: The `mcp/` directory contains MCP server implementations used across examples.

5. **Config**: The shared `config.js` exports model configurations, provider settings, and common utilities used by examples and tasks.

6. **Task Structure**: Each task folder should be treated as an independent project with its own `package.json` and `node_modules`. Follow the structure of the existing tasks.

7. **Flags**: Always print the flag in the console when the task is completed.

8. **Logs**: Always add logs to the console to show the progress of the task and save the logs in a timestamped file.

9. **README.md**: Don't add readme files to task folders.

