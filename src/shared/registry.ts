import {
  Module,
  ModuleContext,
  ModuleHandle,
  PermissionDescriptor,
} from "./module.js";
import { ModuleUnavailableError } from "./errors.js";

export type ModuleStatus = "available" | "unavailable";

interface RegistryEntry {
  module: Module;
  status: ModuleStatus;
  handle?: ModuleHandle;
  error?: Error;
}

/**
 * Module Registry (Requirement 13).
 *
 * Loads only enabled modules, isolates per-module init failures (AC 13.7),
 * exposes each module's single interface (AC 13.1), aggregates permission
 * descriptors (AC 13.2), and rejects calls to disabled/failed modules (AC 13.6).
 */
export class ModuleRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly enabled: Set<string>;

  constructor(enabledModuleKeys: string[]) {
    this.enabled = new Set(enabledModuleKeys);
  }

  /**
   * Loads the given modules. Only enabled modules are initialized. A module
   * that throws during init is recorded as unavailable without terminating
   * the others (AC 13.7).
   */
  load(modules: Module[]): void {
    const ctx: ModuleContext = {
      getModule: <T>(key: string): T => this.getInterface<T>(key),
    };

    for (const module of modules) {
      if (!this.enabled.has(module.key)) {
        continue; // AC 13.5: disabled modules are omitted entirely.
      }
      try {
        const handle = module.init(ctx);
        this.entries.set(module.key, {
          module,
          status: "available",
          handle,
        });
      } catch (err) {
        this.entries.set(module.key, {
          module,
          status: "unavailable",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }

  /** Keys of modules that loaded successfully and are enabled. */
  availableModuleKeys(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.status === "available")
      .map((e) => e.module.key);
  }

  status(key: string): ModuleStatus | undefined {
    return this.entries.get(key)?.status;
  }

  /**
   * Returns a module's public interface. Throws ModuleUnavailableError if the
   * module is disabled or failed to load (AC 13.6).
   */
  getInterface<T = Record<string, unknown>>(key: string): T {
    const entry = this.entries.get(key);
    if (!entry || entry.status !== "available" || !entry.handle) {
      throw new ModuleUnavailableError(key);
    }
    return entry.handle.interface as T;
  }

  /** Aggregated permission descriptors from all available modules (AC 13.2). */
  allPermissionDescriptors(): PermissionDescriptor[] {
    const out: PermissionDescriptor[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "available") {
        out.push(...entry.module.permissions);
      }
    }
    return out;
  }
}
