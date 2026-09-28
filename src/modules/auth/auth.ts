import { createHash, randomUUID } from "node:crypto";
import { Clock } from "../../shared/clock.js";
import { AuthenticationError } from "../../shared/errors.js";

const INACTIVITY_TIMEOUT_MS = 30 * 60_000; // 30 minutes (AC 1.3)

export type UserStatus = "Active" | "Deactivated";

export interface AuthUser {
  id: string;
  identifier: string;
  credentialHash: string;
  status: UserStatus;
}

interface SessionRecord {
  token: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  endedAt?: Date;
}

export interface ResolvedSession {
  userId: string;
}

export function hashCredential(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Auth_Service (Requirement 1, plus deactivation enforcement from Req 2).
 *
 * Credential verification, session creation/termination, 30-minute inactivity
 * timeout evaluated on access via an injectable clock, and deactivation
 * enforcement.
 */
export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();
  /** userId -> set of active session tokens */
  private readonly userSessions = new Map<string, Set<string>>();

  constructor(
    private readonly clock: Clock,
    private readonly lookupUser: (identifier: string) => AuthUser | undefined
  ) {}

  /** AC 1.1, 1.2, 2.6: reject bad credentials and deactivated accounts. */
  signIn(identifier: string, credential: string): { token: string } {
    const user = this.lookupUser(identifier);
    if (!user || user.status === "Deactivated") {
      throw new AuthenticationError("Invalid credentials");
    }
    if (user.credentialHash !== hashCredential(credential)) {
      throw new AuthenticationError("Invalid credentials");
    }
    const now = this.clock.now();
    const token = randomUUID();
    this.sessions.set(token, {
      token,
      userId: user.id,
      createdAt: now,
      lastActivityAt: now,
    });
    if (!this.userSessions.has(user.id)) {
      this.userSessions.set(user.id, new Set());
    }
    this.userSessions.get(user.id)!.add(token);
    return { token };
  }

  /** AC 1.4: end the session. */
  signOut(token: string): void {
    const s = this.sessions.get(token);
    if (s && !s.endedAt) {
      s.endedAt = this.clock.now();
      this.userSessions.get(s.userId)?.delete(token);
    }
  }

  /**
   * AC 1.3, 1.5: resolve a session, enforcing inactivity timeout. Sliding
   * window: updates lastActivityAt on each successful resolve.
   */
  resolveSession(token: string): ResolvedSession {
    const s = this.sessions.get(token);
    if (!s || s.endedAt) {
      throw new AuthenticationError("Authentication required");
    }
    const now = this.clock.now();
    const idleMs = now.getTime() - s.lastActivityAt.getTime();
    if (idleMs >= INACTIVITY_TIMEOUT_MS) {
      s.endedAt = now;
      this.userSessions.get(s.userId)?.delete(token);
      throw new AuthenticationError("Session expired");
    }
    s.lastActivityAt = now;
    return { userId: s.userId };
  }

  /** AC 2.7: terminate all sessions for a user (on deactivation). */
  terminateAllSessions(userId: string): void {
    const tokens = this.userSessions.get(userId);
    if (!tokens) return;
    const now = this.clock.now();
    for (const token of tokens) {
      const s = this.sessions.get(token);
      if (s && !s.endedAt) s.endedAt = now;
    }
    tokens.clear();
  }
}
