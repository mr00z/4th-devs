import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const LOG_DIR = "./logs";

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(): string {
  const date = new Date().toISOString().split("T")[0];
  return path.join(LOG_DIR, `conversations-${date}.log`);
}

export function logConversation(sessionId: string, role: string, content: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${sessionId}] [${role}] ${content}\n`;
  appendFileSync(getLogFile(), line);
}

export function logEvent(sessionId: string, event: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  const line = `[${timestamp}] [${sessionId}] [EVENT:${event}]${dataStr}\n`;
  appendFileSync(getLogFile(), line);
}

export function logSecretCode(sessionId: string, code: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${sessionId}] ${code}\n`;
  appendFileSync(path.join(LOG_DIR, "secret-codes.log"), line);
}
