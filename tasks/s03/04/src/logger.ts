import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs");

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `tool-api-${date}.log`);
}

function write(level: "INFO" | "ERROR", message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  const line = `[${timestamp}] [${level}] ${message}${suffix}`;

  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }

  appendFileSync(getLogFile(), `${line}\n`);
}

export function logInfo(message: string, data?: unknown): void {
  write("INFO", message, data);
}

export function logError(message: string, data?: unknown): void {
  write("ERROR", message, data);
}
