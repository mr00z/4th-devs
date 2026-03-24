import { AI_API_KEY, RESPONSES_API_ENDPOINT } from "./config.js";

export interface ChatInput {
  model: string;
  input: unknown[];
  tools?: unknown[];
  instructions?: string;
}

const extractResponseText = (data: unknown): string | null => {
  const d = data as Record<string, unknown>;

  if (typeof d?.output_text === "string") {
    return d.output_text.trim() || null;
  }

  const output = Array.isArray(d?.output) ? d.output : [];
  const message = output.find((o) => (o as { type?: string })?.type === "message");
  const content = Array.isArray((message as { content?: unknown[] })?.content)
    ? (message as { content: unknown[] }).content
    : [];
  const part = content.find((c) => (c as { type?: string })?.type === "output_text");
  const text = (part as { text?: string })?.text?.trim();

  return text || null;
};

export const chat = async ({ model, input, tools, instructions }: ChatInput) => {
  const body: Record<string, unknown> = { model, input };
  if (tools?.length) body.tools = tools;
  if (instructions) body.instructions = instructions;

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok || (data as { error?: unknown })?.error) {
    const errorDetails = {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      error: (data as { error?: { message?: string; type?: string; code?: string; param?: string } })?.error,
      fullResponse: data,
      requestBody: body,
    };

    console.error("[AI] API Error Details:", JSON.stringify(errorDetails, null, 2));

    const errorMsg =
      errorDetails.error?.message ||
      `API request failed (${response.status})`;
    throw new Error(errorMsg);
  }

  return data;
};

export const extractToolCalls = (response: unknown) => {
  const d = response as Record<string, unknown>;
  const output = Array.isArray(d?.output) ? d.output : [];
  return output.filter((item) => (item as { type?: string })?.type === "function_call");
};

export const extractText = (response: unknown): string | null => {
  return extractResponseText(response);
};
