/**
 * Simple colored logger for terminal output with file logging.
 */

import fs from 'fs';
import path from 'path';

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m"
};

const timestamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const fullTimestamp = () => new Date().toISOString();

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file with timestamp
const logFile = path.join(logsDir, `agent-${new Date().toISOString().split('T')[0]}.log`);

// Helper function to write to file
const writeToFile = (message: string) => {
  try {
    fs.appendFileSync(logFile, `${fullTimestamp()} ${message}\n`);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
};

// Clear log file on startup
const clearLogFile = () => {
  try {
    fs.writeFileSync(logFile, '');
  } catch (err) {
    console.error('Failed to clear log file:', err);
  }
};

// Log initialization
console.log(`${colors.cyan}📝 Logs will be saved to: ${logFile}${colors.reset}`);
clearLogFile();
writeToFile('=== LOG SESSION STARTED ===');

const log = {
  info: (msg: string) => {
    const cleanMsg = `INFO ${msg}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${msg}`);
    writeToFile(cleanMsg);
  },
  success: (msg: string) => {
    const cleanMsg = `SUCCESS ${msg}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}✓${colors.reset} ${msg}`);
    writeToFile(cleanMsg);
  },
  error: (title: string, msg?: string) => {
    const cleanMsg = `ERROR ${title}${msg ? ' ' + msg : ''}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}✗ ${title}${colors.reset} ${msg || ""}`);
    writeToFile(cleanMsg);
  },
  warn: (msg: string) => {
    const cleanMsg = `WARN ${msg}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${msg}`);
    writeToFile(cleanMsg);
  },
  start: (msg: string) => {
    const cleanMsg = `START ${msg}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}→${colors.reset} ${msg}`);
    writeToFile(cleanMsg);
  },
  
  box: (text: string) => {
    const cleanMsg = `BOX ${text.replace(/\n/g, ' ')}`;
    const lines = text.split("\n");
    const width = Math.max(...lines.map(l => l.length)) + 4;
    console.log(`\n${colors.cyan}${"─".repeat(width)}${colors.reset}`);
    for (const line of lines) {
      console.log(`${colors.cyan}│${colors.reset} ${colors.bright}${line.padEnd(width - 3)}${colors.reset}${colors.cyan}│${colors.reset}`);
    }
    console.log(`${colors.cyan}${"─".repeat(width)}${colors.reset}\n`);
    writeToFile(cleanMsg);
  },

  api: (step: string, msgCount?: number) => {
    const cleanMsg = `API ${step}${msgCount ? ` (${msgCount} messages)` : ""}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.magenta}◆${colors.reset} ${step}${msgCount ? ` (${msgCount} messages)` : ""}`);
    writeToFile(cleanMsg);
  },
  apiDone: (response: string) => {
    const cleanMsg = `API_RESPONSE ${response}`;
    console.log(`${colors.dim}         ${colors.green}Response:${colors.reset} ${response}${colors.reset}\n`);
    writeToFile(cleanMsg);
  },
  
  tool: (name: string, args: Record<string, unknown>) => {
    const argStr = JSON.stringify(args);
    const truncated = argStr.length > 300 ? argStr.substring(0, 300) + "..." : argStr;
    const cleanMsg = `TOOL ${name} ${truncated}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}⚡${colors.reset} ${name} ${colors.dim}${truncated}${colors.reset}`);
    writeToFile(cleanMsg);
  },
  
  toolResult: (name: string, success: boolean, output: string) => {
    const icon = success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const cleanMsg = `TOOL_RESULT ${name} ${success ? 'SUCCESS' : 'ERROR'} ${output}`;
    console.log(`${colors.dim}         ${icon} ${output}${colors.reset}`);
    writeToFile(cleanMsg);
  },

  agent: (agentName: string, msg: string) => {
    const cleanMsg = `AGENT [${agentName}] ${msg}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.blue}[${agentName}]${colors.reset} ${msg}`);
    writeToFile(cleanMsg);
  },
  agentTurn: (turn: number, maxTurns: number) => {
    const cleanMsg = `TURN ${turn}/${maxTurns}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.blue}Turn ${turn}/${maxTurns}${colors.reset}`);
    writeToFile(cleanMsg);
  },

  verification: (attempt: number) => {
    const cleanMsg = `VERIFY Attempt ${attempt}`;
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.bgMagenta}${colors.white} VERIFY ${colors.reset} Attempt ${attempt}`);
    writeToFile(cleanMsg);
  },
  verificationResult: (success: boolean, response: string) => {
    const icon = success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const cleanMsg = `VERIFY_RESULT ${success ? 'SUCCESS' : 'ERROR'} ${response}`;
    console.log(`${colors.dim}         ${icon} ${response}${colors.reset}`);
    writeToFile(cleanMsg);
  }
};

export default log;
