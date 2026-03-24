import { chat, extractToolCalls, extractText } from "./ai.js";
import { toolHandlers } from "./tools.js";
import { sessionStore, type Message } from "./session-store.js";

const MAX_TOOL_ROUNDS = 10;

// Detect secret codes in format {FLG:CODEHERE}
function extractSecretCode(text: string): string | null {
  const match = text.match(/\{FLG:([^}]+)\}/);
  return match ? match[1] : null;
}

interface ToolCall {
  call_id: string;
  name: string;
  arguments: string;
}

interface AgentConfig {
  model: string;
  tools: unknown[];
  instructions: string;
}

interface ConversationItem {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ToolCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

interface ToolOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

type ChatInputItem = ConversationItem | ToolCallItem | ToolOutputItem;

const executeToolCall = async (call: ToolCall) => {
  const args = JSON.parse(call.arguments);
  const handler = toolHandlers[call.name];

  if (!handler) {
    return {
      type: "function_call_output" as const,
      call_id: call.call_id,
      output: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
    };
  }

  try {
    const result = await handler(args);
    return {
      type: "function_call_output" as const,
      call_id: call.call_id,
      output: JSON.stringify(result),
    };
  } catch (error) {
    return {
      type: "function_call_output" as const,
      call_id: call.call_id,
      output: JSON.stringify({ error: (error as Error).message }),
    };
  }
};

export const createAgent = ({ model, tools, instructions }: AgentConfig) => ({
  async processQuery(sessionId: string, query: string): Promise<string> {
    // Get existing session history or start fresh
    const history: Message[] = sessionStore.get(sessionId);
    const conversation: ChatInputItem[] = [
      ...history.map((m) => ({ role: m.role, content: m.content }) as ConversationItem),
      { role: "user", content: query },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await chat({
        model,
        input: conversation,
        tools,
        instructions,
      });

      const toolCalls = extractToolCalls(response) as ToolCall[];

      if (toolCalls.length === 0) {
        const text = extractText(response) ?? "No response";

        // Check for secret code in user's message
        const secretCode = extractSecretCode(query);
        if (secretCode) {
          sessionStore.saveSecretCode(sessionId, secretCode);
        }

        // Save conversation to session
        sessionStore.add(sessionId, { role: "user", content: query });
        sessionStore.add(sessionId, { role: "assistant", content: text });

        return text;
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map((call) => executeToolCall(call))
      );

      // Add tool calls and results to conversation
      conversation.push(...(response as { output: ChatInputItem[] }).output);
      conversation.push(...toolResults);
    }

    // Max rounds reached
    const fallback = "Max tool rounds reached";
    sessionStore.add(sessionId, { role: "user", content: query });
    sessionStore.add(sessionId, { role: "assistant", content: fallback });
    return fallback;
  },
});
