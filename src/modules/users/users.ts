import { newId } from "../../shared/id.js";
import { hashCredential, AuthUser, UserStatus } from "../auth/auth.js";
import { PermissionService } from "../permission/permission.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";

export interface UserRecord {
  id: string;
  identifier: string;
  email?: string;
  displayName: string;
  credentialHash: string;
  status: UserStatus;
  roleIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  identifier: string;
  email?: string;
  displayName?: string;
  credential: string;
  roleIds: string[];
}

export const normalizeEmail = (email: string | undefined | null): string => (email ?? "").trim().toLowerCase();

/**
 * Users module (Requirement 2). create/read/edit/deactivate with unique
 * identifier (1..255) and at least one assigned role.
 */
export class UsersService {
  private readonly users = new Map<string, UserRecord>();
  private readonly byIdentifier = new Map<string, string>();
  private readonly byEmail = new Map<string, string>();

  constructor(
    private readonly permissions: PermissionService,
    private readonly onDeactivate: (userId: string) => void
  ) {}

  /** AC 2.2, 2.4, 2.5. */
  createUser(input: CreateUserInput): UserRecord {
    const identifier = (input.identifier ?? "").trim();
    if (identifier.length < 1 || identifier.length > 255) {
      throw new ValidationError(
        "identifier must be 1 to 255 characters",
        "identifier"
      );
    }
    if (!input.roleIds || input.roleIds.length < 1) {
      throw new ValidationError("at least one role is required", "roleIds");
    }
    if (this.identifierOwner(identifier)) {
      throw new ConflictError("identifier already exists", "identifier");
    }
    const email = normalizeEmail(input.email);
    if (email && this.byEmail.has(email)) {
      throw new ConflictError("email already registered", "email");
    }
    const now = new Date();
    const record: UserRecord = {
      id: newId(),
      identifier,
      ...(email ? { email } : {}),
      displayName: input.displayName ?? identifier,
      credentialHash: hashCredential(input.credential),
      status: "Active",
      roleIds: [...input.roleIds],
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(record.id, record);
    this.byIdentifier.set(identifier, record.id);
    if (email) this.byEmail.set(email, record.id);
    for (const roleId of record.roleIds) {
      this.permissions.assignUserRole(record.id, roleId);
    }
    return record;
  }

  getUser(id: string): UserRecord {
    const u = this.users.get(id);
    if (!u) throw new NotFoundError("user not found");
    return u;
  }

  listUsers(): UserRecord[] {
    return [...this.users.values()];
  }

  setCredential(id: string, credential: string): void {
    const u = this.getUser(id);
    u.credentialHash = hashCredential(credential);
    u.updatedAt = new Date();
  }

  /** Change this person's roles. Permission grants are synced by the API layer. */
  setRoleIds(id: string, roleIds: string[]): UserRecord {
    const u = this.getUser(id);
    if (!roleIds || roleIds.length < 1) {
      throw new ValidationError("at least one role is required", "roleIds");
    }
    u.roleIds = [...roleIds];
    u.updatedAt = new Date();
    return u;
  }

  /** Rename the sign-in name and keep the lookup map in step with it. */
  setIdentifier(id: string, identifier: string): void {
    const next = (identifier ?? "").trim();
    if (next.length < 1 || next.length > 255) {
      throw new ValidationError("identifier must be 1 to 255 characters", "identifier");
    }
    const u = this.getUser(id);
    const owner = this.identifierOwner(next);
    if (owner && owner !== id) {
      throw new ConflictError("identifier already exists", "identifier");
    }
    this.dropIdentifierKeys(id);
    u.identifier = next;
    this.byIdentifier.set(next, id);
    u.updatedAt = new Date();
  }

  /** Change the sign-in email and keep the lookup map in step with it. */
  setEmail(id: string, email: string): void {
    const u = this.getUser(id);
    const next = normalizeEmail(email);
    if (next) {
      const owner = this.byEmail.get(next);
      if (owner && owner !== id) {
        throw new ConflictError("email already registered", "email");
      }
    }
    this.dropEmailKeys(id);
    if (next) {
      u.email = next;
      this.byEmail.set(next, id);
    } else {
      delete u.email;
    }
    u.updatedAt = new Date();
  }

  hasIdentifier(identifier: string): boolean {
    return this.identifierOwner(identifier) !== undefined;
  }

  hasEmail(email: string): boolean {
    return this.byEmail.has(normalizeEmail(email));
  }

  exportSnapshot(): UserRecord[] {
    return this.listUsers();
  }

  importSnapshot(records: UserRecord[]): void {
    for (const raw of records ?? []) {
      if (!raw?.id || !raw.identifier) continue;
      if (this.users.has(raw.id) || this.byIdentifier.has(raw.identifier)) continue;
      const rec: UserRecord = {
        ...raw,
        roleIds: [...(raw.roleIds ?? [])],
        createdAt: new Date(raw.createdAt),
        updatedAt: new Date(raw.updatedAt),
      };
      this.users.set(rec.id, rec);
      this.byIdentifier.set(rec.identifier, rec.id);
      if (rec.email) this.byEmail.set(normalizeEmail(rec.email), rec.id);
      for (const roleId of rec.roleIds) {
        this.permissions.assignUserRole(rec.id, roleId);
      }
    }
  }

  /** AC 2.6, 2.7: deactivate blocks sign-in and terminates sessions. */
  deactivateUser(id: string): UserRecord {
    const u = this.getUser(id);
    u.status = "Deactivated";
    u.updatedAt = new Date();
    this.onDeactivate(id);
    return u;
  }

  /** Permanently delete a user account. */
  deleteUser(id: string): void {
    const u = this.getUser(id);
    this.onDeactivate(id);          // end sessions first
    this.dropIdentifierKeys(id);
    this.dropEmailKeys(id);
    this.users.delete(id);
  }

  /** Adapter for Auth's user lookup. Accepts the username, the person's name, or the registered email. */
  lookupForAuth(identifier: string): AuthUser | undefined {
    const id = this.identifierOwner(identifier) ?? this.byEmail.get(normalizeEmail(identifier)) ?? this.displayNameOwner(identifier);
    if (!id) return undefined;
    const u = this.users.get(id)!;
    return {
      id: u.id,
      identifier: u.identifier,
      credentialHash: u.credentialHash,
      status: u.status,
    };
  }

  /** The person's name, when only one account uses it. Capitals are ignored. */
  private displayNameOwner(name: string): string | undefined {
    const want = (name ?? "").trim().toLowerCase();
    if (!want) return undefined;
    const matches = [...this.users.values()].filter((user) => (user.displayName || "").trim().toLowerCase() === want);
    return matches.length === 1 ? matches[0].id : undefined;
  }

  /** Exact match first, then capitals ignored, so the sign-in page can send a lowercase name. */
  private identifierOwner(identifier: string): string | undefined {
    const trimmed = (identifier ?? "").trim();
    if (!trimmed) return undefined;
    const exact = this.byIdentifier.get(trimmed);
    if (exact) return exact;
    const want = trimmed.toLowerCase();
    for (const [key, id] of this.byIdentifier) {
      if (key.toLowerCase() === want) return id;
    }
    return undefined;
  }

  private dropIdentifierKeys(userId: string): void {
    for (const [key, id] of this.byIdentifier) {
      if (id === userId) this.byIdentifier.delete(key);
    }
  }

  private dropEmailKeys(userId: string): void {
    for (const [key, id] of this.byEmail) {
      if (id === userId) this.byEmail.delete(key);
    }
  }
}
