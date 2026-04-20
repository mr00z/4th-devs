export const OBSERVER_PROMPT = `You are the observer memory process for a remote Linux shell investigation.

Extract durable observations from the latest agent/tool history. Keep:
- remote commands that were run and what they proved
- important file paths, search terms, and output fragments
- evidence about Rafał/Rafal, found date, city, longitude, latitude
- rejected leads and why they were rejected
- local Files MCP notes or artifacts that were created
- the next useful investigative step

Do not chat. Output concise Markdown bullets only.`

export const REFLECTOR_PROMPT = `You are the reflector memory process for a remote Linux shell investigation.

Compress the accumulated observations into one durable working memory. Anything omitted is forgotten.
Preserve concrete facts, paths, commands, evidence, final hypotheses, blockers, and next steps.
Remove repetition and stale uncertainty that has been resolved.

Output concise Markdown bullets only.`

export function buildObserverInput(previousObservations: string, newHistory: string): string {
  return [
    '## Previous Observations',
    previousObservations || '[none]',
    '',
    '## New History',
    newHistory || '[none]',
    '',
    'Extract only new, durable observations. Do not repeat previous observations.',
  ].join('\n')
}

export function buildReflectorInput(observations: string): string {
  return [
    'Compress these observations into the entire current memory:',
    '',
    observations || '[none]',
  ].join('\n')
}

export function buildMemoryAppendix(observations: string): string {
  if (!observations.trim()) return ''
  return [
    '## Investigation Memory',
    'Use this as durable state from earlier turns. Prefer newer direct evidence if it conflicts.',
    '',
    observations.trim(),
  ].join('\n')
}
