/**
 * Modular monolith contract (Requirement 13).
 *
 * Every module exposes all externally invokable functions through its
 * `interface` object and nothing else (AC 13.1). Modules own their own data
 * and communicate only through registered interfaces (AC 13.4).
 */

export type PermissionAction = "create" | "read" | "edit" | "delete";

export interface PermissionDescriptor {
  module: string;
  action: PermissionAction;
}

export interface ModuleContext {
  /** Look up another enabled module's public interface by key (AC 13.1). */
  getModule<T = Record<string, unknown>>(key: string): T;
}

export interface ModuleHandle {
  /** The ONLY externally invokable surface of the module (AC 13.1). */
  interface: Record<string, unknown>;
}

export interface Module {
  /** Unique module key, e.g. "Inspection". */
  key: string;
  /** (module, action) permission descriptors this module registers (AC 13.2). */
  permissions: PermissionDescriptor[];
  /** Wiring; may throw on failure (isolated by the registry, AC 13.7). */
  init(ctx: ModuleContext): ModuleHandle;
}
