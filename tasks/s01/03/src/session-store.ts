import { logConversation, logSecretCode } from "./logger.js";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

type Session = {
  messages: Message[];
  lastActivity: number;
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class SessionStore {
  private sessions = new Map<string, Session>();

  constructor() {
    setInterval(() => this.cleanup(), 60 * 60 * 1000); // Cleanup every hour
  }

  get(sessionId: string): Message[] {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      return [...session.messages];
    }
    return [];
  }

  add(sessionId: string, message: Message): void {
    logConversation(sessionId, message.role, message.content);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.lastActivity = Date.now();
    } else {
      this.sessions.set(sessionId, {
        messages: [message],
        lastActivity: Date.now(),
      });
    }
  }

  saveSecretCode(sessionId: string, code: string): void {
    logSecretCode(sessionId, code);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export const sessionStore = new SessionStore();
export type { Message };
