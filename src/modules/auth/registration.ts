import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { AuthorizationError, NotFoundError, ValidationError, ConflictError } from "../../shared/errors.js";
import { normalizeEmail, type UsersService } from "../users/users.js";

export interface RegistrationInput {
  identifier: string;
  email: string;
  displayName?: string;
  credential: string;
}

export type SendOtp = (email: string, code: string, displayName: string) => Promise<void>;

interface Pending {
  id: string;
  identifier: string;
  email: string;
  displayName: string;
  credential: string;
  otpHash: string;
  expiresAt: number;
  sentAt: number;
  attempts: number;
}

const OTP_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_PENDING = 200;

const hashOtp = (id: string, code: string) => createHash("sha256").update(id + ":" + code).digest();

/**
 * Self-registration for Super Admins, gated by an email allow-list and
 * confirmed with a 6-digit code sent to that email. Nothing is saved to the
 * users table until the code is verified.
 */
export class RegistrationService {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly users: UsersService,
    private readonly allowList: string[],
    private readonly sendOtp: SendOtp,
    private readonly superAdminRoleId: string,
    readonly companyDomain: string,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.allowList.length > 0;
  }

  /** The only address allowed to register, when the allow-list is a single full email. */
  get fixedEmail(): string | null {
    return this.allowList.length === 1 && !this.allowList[0].startsWith("@") ? this.allowList[0] : null;
  }

  isAllowed(email: string): boolean {
    const e = normalizeEmail(email);
    const domain = e.slice(e.indexOf("@"));
    if (this.companyDomain && domain !== "@" + this.companyDomain) return false;
    return this.allowList.some((rule) => rule === e || (rule.startsWith("@") && rule === domain));
  }

  async start(input: RegistrationInput): Promise<{ registrationId: string; email: string; expiresInSeconds: number }> {
    if (!this.enabled) throw new AuthorizationError("Registration is turned off on this server");
    const identifier = String(input.identifier ?? "").trim().toLowerCase();
    const email = normalizeEmail(input.email);
    const credential = String(input.credential ?? "").trim();
    const displayName = String(input.displayName ?? "").trim() || identifier;
    if (!/^[a-z0-9._-]{3,40}$/.test(identifier))
      throw new ValidationError("User ID must be 3 to 40 letters, numbers, dots, dashes or underscores", "identifier");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address", "email");
    if (credential.length < 6 || !/[A-Za-z]/.test(credential) || !/[^A-Za-z0-9\s]/.test(credential))
      throw new ValidationError("Password must be at least 6 characters with a letter and a special character (like @ # !)", "credential");
    if (this.companyDomain && !email.endsWith("@" + this.companyDomain))
      throw new AuthorizationError(`Use your company email ending in @${this.companyDomain}`);
    if (!this.isAllowed(email)) throw new AuthorizationError("This email is not allowed to register as Super Admin");
    if (this.users.hasIdentifier(identifier)) throw new ConflictError("This User ID is already taken", "identifier");
    if (this.users.hasEmail(email)) throw new ConflictError("This email is already registered", "email");

    this.prune();
    const now = this.now();
    for (const [id, p] of this.pending) {
      if (p.email !== email) continue;
      const wait = Math.ceil((p.sentAt + RESEND_COOLDOWN_MS - now) / 1000);
      if (wait > 0) throw new ValidationError(`A code was just sent. Please wait ${wait} seconds before trying again.`);
      this.pending.delete(id);
    }
    if (this.pending.size >= MAX_PENDING) throw new ValidationError("Too many registrations in progress. Try again later.");

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.sendOtp(email, code, displayName);
    this.pending.set(id, {
      id,
      identifier,
      email,
      displayName,
      credential,
      otpHash: hashOtp(id, code).toString("hex"),
      expiresAt: now + OTP_TTL_MS,
      sentAt: now,
      attempts: 0,
    });
    return { registrationId: id, email, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  async resend(registrationId: string): Promise<{ expiresInSeconds: number }> {
    const p = this.get(registrationId);
    const now = this.now();
    const wait = Math.ceil((p.sentAt + RESEND_COOLDOWN_MS - now) / 1000);
    if (wait > 0) throw new ValidationError(`Please wait ${wait} seconds before asking for a new code`);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.sendOtp(p.email, code, p.displayName);
    p.otpHash = hashOtp(p.id, code).toString("hex");
    p.expiresAt = now + OTP_TTL_MS;
    p.sentAt = now;
    p.attempts = 0;
    return { expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  verify(registrationId: string, code: string): { id: string; identifier: string; email: string } {
    const p = this.get(registrationId);
    if (p.attempts >= MAX_ATTEMPTS) {
      this.pending.delete(p.id);
      throw new ValidationError("Too many wrong codes. Start the registration again.");
    }
    p.attempts++;
    const given = hashOtp(p.id, String(code ?? "").trim());
    if (!timingSafeEqual(given, Buffer.from(p.otpHash, "hex"))) {
      const left = MAX_ATTEMPTS - p.attempts;
      if (left <= 0) this.pending.delete(p.id);
      throw new ValidationError(left > 0 ? `Wrong code. ${left} tries left.` : "Too many wrong codes. Start the registration again.", "code");
    }
    this.pending.delete(p.id);
    const user = this.users.createUser({
      identifier: p.identifier,
      email: p.email,
      displayName: p.displayName,
      credential: p.credential,
      roleIds: [this.superAdminRoleId],
    });
    return { id: user.id, identifier: user.identifier, email: p.email };
  }

  private get(registrationId: string): Pending {
    this.prune();
    const p = this.pending.get(String(registrationId ?? ""));
    if (!p) throw new NotFoundError("This code has expired. Start the registration again.");
    return p;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, p] of this.pending) if (p.expiresAt < now) this.pending.delete(id);
  }
}
