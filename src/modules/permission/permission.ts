import { PermissionAction } from "../../shared/module.js";
import { ConflictError, PersistenceError } from "../../shared/errors.js";

export interface Role {
  id: string;
  name: string;
}

/** A (module, action) pair. */
export interface PermissionKey {
  module: string;
  action: PermissionAction;
}

function keyStr(module: string, action: PermissionAction): string {
  return `${module}:${action}`;
}

/**
 * Permission_Service (Requirements 3, 11).
 *
 * Evaluates whether a user's roles grant a given (module, action) permission
 * and enforces the union-of-roles rule. Authorization is the single choke
 * point used by the API pipeline.
 */
export class PermissionService {
  private readonly roles = new Map<string, Role>();
  /** roleId -> set of "module:action" */
  private readonly rolePerms = new Map<string, Set<string>>();
  /** userId -> set of roleIds */
  private readonly userRoles = new Map<string, Set<string>>();
  /** userId -> direct per-user "module:action" grants (in addition to roles) */
  private readonly userPerms = new Map<string, Set<string>>();
  /** registered (module, action) descriptors modules declared (AC 13.2) */
  private readonly registered = new Set<string>();

  registerRole(role: Role): void {
    this.roles.set(role.id, role);
    if (!this.rolePerms.has(role.id)) this.rolePerms.set(role.id, new Set());
  }

  /** Ingest a module's permission descriptors (AC 13.2). */
  registerPermission(module: string, action: PermissionAction): void {
    this.registered.add(keyStr(module, action));
  }

  isRegistered(module: string, action: PermissionAction): boolean {
    return this.registered.has(keyStr(module, action));
  }

  assignUserRole(userId: string, roleId: string): void {
    if (!this.userRoles.has(userId)) this.userRoles.set(userId, new Set());
    this.userRoles.get(userId)!.add(roleId);
  }

  getUserRoleIds(userId: string): string[] {
    return [...(this.userRoles.get(userId) ?? [])];
  }

  clearUserRoles(userId: string): void {
    this.userRoles.delete(userId);
    this.userPerms.delete(userId);
  }

  /** Directly grant a per-user (module, action) permission (in addition to roles). */
  setUserPermissions(userId: string, perms: PermissionKey[]): void {
    const next = new Set<string>();
    for (const p of perms) next.add(keyStr(p.module, p.action));
    this.userPerms.set(userId, next);
  }

  exportUserPermissionGrants(): Record<string, PermissionKey[]> {
    const out: Record<string, PermissionKey[]> = {};
    for (const userId of this.userPerms.keys()) {
      out[userId] = this.getUserPermissions(userId);
    }
    return out;
  }

  importUserPermissionGrants(grants: Record<string, PermissionKey[]> | undefined): void {
    for (const [userId, perms] of Object.entries(grants ?? {})) {
      this.setUserPermissions(userId, perms ?? []);
    }
  }

  getUserPermissions(userId: string): PermissionKey[] {
    const set = this.userPerms.get(userId) ?? new Set<string>();
    return [...set].map((s) => {
      const [module, action] = s.split(":");
      return { module, action: action as PermissionAction };
    });
  }

  /**
   * Persist a role's full permission set (AC 3.2). Replaces the prior set.
   * If persistence fails, the prior assignment is retained unchanged (AC 3.6).
   */
  setRolePermissions(roleId: string, perms: PermissionKey[]): void {
    if (!this.roles.has(roleId)) {
      throw new ConflictError("Role does not exist", "roleId");
    }
    const next = new Set<string>();
    for (const p of perms) next.add(keyStr(p.module, p.action));
    // Simulated atomic replace: build first, then commit.
    try {
      this.rolePerms.set(roleId, next);
    } catch {
      throw new PersistenceError("Permission assignment was not saved");
    }
  }

  getRolePermissions(roleId: string): PermissionKey[] {
    const set = this.rolePerms.get(roleId) ?? new Set<string>();
    return [...set].map((s) => {
      const [module, action] = s.split(":");
      return { module, action: action as PermissionAction };
    });
  }

  /** Roles that always keep their full role permissions (e.g. Super Admin). */
  readonly fullAccessRoles = new Set<string>();

  /** Grant marking a user whose permissions were set by hand. */
  static readonly CUSTOM_MARKER = "Meta:custom";

  /**
   * Role defaults apply until the Super Admin saves a per-user permission set;
   * from then on only the ticked permissions count (full-access roles excepted).
   */
  getEffectivePermissions(userId: string): Set<string> {
    const out = new Set<string>();
    const own = this.userPerms.get(userId);
    const roleIds = this.getUserRoleIds(userId);
    const useRoles = !own?.has(PermissionService.CUSTOM_MARKER) || roleIds.some((r) => this.fullAccessRoles.has(r));
    if (useRoles) {
      for (const roleId of roleIds) {
        for (const p of this.rolePerms.get(roleId) ?? []) out.add(p);
      }
    }
    for (const p of own ?? []) out.add(p);
    return out;
  }

  /**
   * The single authorization choke point (AC 3.3, 3.4, 11.1, 11.2).
   * Returns true iff the union of the user's roles holds the (module, action).
   */
  authorize(userId: string, module: string, action: PermissionAction): boolean {
    return this.getEffectivePermissions(userId).has(keyStr(module, action));
  }
}
