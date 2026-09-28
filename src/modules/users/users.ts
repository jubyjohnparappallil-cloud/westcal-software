import { newId } from "../../shared/id.js";
import { hashCredential, AuthUser, UserStatus } from "../auth/auth.js";
import { PermissionService } from "../permission/permission.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";

export interface UserRecord {
  id: string;
  identifier: string;
  displayName: string;
  credentialHash: string;
  status: UserStatus;
  roleIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  identifier: string;
  displayName?: string;
  credential: string;
  roleIds: string[];
}

/**
 * Users module (Requirement 2). create/read/edit/deactivate with unique
 * identifier (1..255) and at least one assigned role.
 */
export class UsersService {
  private readonly users = new Map<string, UserRecord>();
  private readonly byIdentifier = new Map<string, string>();

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
    if (this.byIdentifier.has(identifier)) {
      throw new ConflictError("identifier already exists", "identifier");
    }
    const now = new Date();
    const record: UserRecord = {
      id: newId(),
      identifier,
      displayName: input.displayName ?? identifier,
      credentialHash: hashCredential(input.credential),
      status: "Active",
      roleIds: [...input.roleIds],
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(record.id, record);
    this.byIdentifier.set(identifier, record.id);
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

  hasIdentifier(identifier: string): boolean {
    return this.byIdentifier.has(identifier);
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
    this.byIdentifier.delete(u.identifier);
    this.users.delete(id);
  }

  /** Adapter for Auth's user lookup by identifier. */
  lookupForAuth(identifier: string): AuthUser | undefined {
    const id = this.byIdentifier.get(identifier);
    if (!id) return undefined;
    const u = this.users.get(id)!;
    return {
      id: u.id,
      identifier: u.identifier,
      credentialHash: u.credentialHash,
      status: u.status,
    };
  }
}
