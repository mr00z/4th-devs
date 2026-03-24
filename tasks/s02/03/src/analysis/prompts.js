export const CHUNK_ANALYSIS_INSTRUCTIONS = `You analyze power plant failure logs.

Return JSON only.
Focus on events potentially relevant to recent breakdowns.
One source line can produce at most one selected event.
Prefer CRIT/ERR/WARN and precursor anomalies, but include supporting INFO only when clearly useful.
If verifier hints mention specific components that remain unexplained, or if requiredComponents is provided, treat those components as mandatory investigation targets and prioritize lines about them or their immediate precursors.

REWRITE RULES for the "rewrite" field:
- Do NOT include the timestamp — it is stored separately.
- Do NOT include the severity tag (INFO/WARN/ERRO/CRIT) — it is stored separately.
- Do NOT include brackets [] around anything.
- Do NOT start with the component identifier (e.g. STMTURB12, PWR01) — it is stored separately.
- Paraphrase the log message into a concise one-line summary (max ~80 chars).
- Preserve the technical meaning and key details.
- Example: raw "[2026-03-18 06:02:28] [WARN] Pressure jitter near STMTURB12 is above baseline. Automatic damping remains engaged."
  → rewrite: "Pressure jitter above baseline, automatic damping engaged"`;

export const CHUNK_ANALYSIS_SCHEMA = {
    name: 'failure_chunk_events',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            events: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        lineId: { type: 'integer' },
                        score: { type: 'number' },
                        reason: { type: 'string' },
                        rewrite: { type: 'string' },
                    },
                    required: ['lineId', 'score', 'reason', 'rewrite'],
                },
            },
        },
        required: ['events'],
    },
};

