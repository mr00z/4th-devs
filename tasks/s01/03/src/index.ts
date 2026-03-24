import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { MODEL, SYSTEM_PROMPT, PORT } from "./config.js";
import { toolDefinitions } from "./tools.js";
import { createAgent } from "./agent.js";

const app = new Hono();

const agent = createAgent({
  model: MODEL,
  tools: toolDefinitions,
  instructions: SYSTEM_PROMPT,
});

app.post("/", async (c) => {
  let body: { sessionID?: string; msg?: string } = {};
  try {
    body = await c.req.json();

    if (!body.sessionID || typeof body.sessionID !== "string") {
      return c.json({ error: "Missing or invalid sessionID" }, 400);
    }

    if (!body.msg || typeof body.msg !== "string") {
      return c.json({ error: "Missing or invalid msg" }, 400);
    }

    const response = await agent.processQuery(body.sessionID, body.msg);

    return c.json({ msg: response });
  } catch (error) {
    console.error("[Server] Error processing request:");
    console.error("  Message:", (error as Error).message);
    console.error("  Stack:", (error as Error).stack);
    console.error("  Request body:", body);
    return c.json(
      { error: "Internal server error", msg: (error as Error).message },
      500
    );
  }
});

app.get("/health", (c) => c.json({ status: "ok" }));

console.log(`Server starting on http://localhost:${PORT}`);
serve({
  fetch: app.fetch,
  port: PORT,
});
