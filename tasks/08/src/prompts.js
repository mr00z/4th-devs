export const createChunkAnalysisPrompt = ({ totalChunks, verifierHints, maxEvents }) => {
    const hints = Array.isArray(verifierHints)
        ? verifierHints.map((h) => String(h).trim()).filter(Boolean)
        : [];

    const lines = [
        "You are analyzing a chunk of system logs from a power-plant failure day.",
        "Extract events relevant to the failure: power supply, cooling, water pumps, control software, sensors, safety systems, turbines, generators, valves, pressure, networking, and other plant subsystems.",
        "Include CRIT, ERROR, WARN events and any suspicious precursors (anomalies, trips, interlocks, shutdowns, degraded states).",
        "Exclude routine telemetry, heartbeats, and administrative noise unrelated to the failure.",
        `Return up to ${maxEvents} events from this chunk.`,
        "Keep each event short and information-dense. Preserve the timestamp (YYYY-MM-DD HH:MM), severity level, and subsystem identifier.",
        "You may paraphrase but never remove the timestamp or severity.",
        totalChunks > 1 ? `This is one of ${totalChunks} chunks — local events may be partial evidence.` : "",
        hints.length ? `Verifier feedback: ${hints.join(" | ")}` : ""
    ];

    return lines.filter(Boolean).join("\n");
};

export const MAIN_AGENT_NOTES = [
    "The final logs answer must be a multi-line string, one event per line.",
    "Keep it under 1500 tokens.",
    "Preserve YYYY-MM-DD and HH:MM timestamps.",
    "Keep only events relevant to failure analysis."
].join(" ");
