# Electricity Puzzle Agent

Solves the 3x3 electricity rotation puzzle from the hub endpoint.

## Run

```bash
node tasks/07/app.js
```

## Required environment

- `HUB_API_KEY`
- `VERIFY_ENDPOINT` (optional, defaults to `https://hub.ag3nts.org/verify`)

## Optional environment

- `OPENAI_MAIN_MODEL=gpt-5.4` for the main orchestration/planning agent.
- `OPENAI_VISION_MODEL=gpt-4.1-mini` for the vision sub-agent.
- `ELECTRICITY_USE_TARGET_VISION=true` to analyze [`tasks/07/assets/target-electricity.png`](tasks/07/assets/target-electricity.png) instead of using the built-in target topology.
- `ELECTRICITY_VERIFY_EVERY=3` to re-fetch the live image every N moves as a checkpoint.
- `ELECTRICITY_MAX_MOVES=50` to cap the planned move sequence.

## Notes

- Uses a memory-first board model.
- Reads the live board image once initially, then updates rotations locally.
- Uses the AI vision step to normalize the initial and target boards into a tile schema.
- Stores the local target reference image in `assets/target-electricity.png`.
- By default, uses a built-in target topology derived from the provided second reference image, so the solver can run even before a real target file is saved.
- Supports separate configuration for the main agent model and the vision model through [`puzzleConfig.mainModel`](tasks/07/src/config.js:22) and [`puzzleConfig.visionModel`](tasks/07/src/config.js:23).
