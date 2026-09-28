import { randomUUID } from "node:crypto";

/** Opaque UUID generator, wrapped so it can be stubbed in tests if needed. */
export function newId(): string {
  return randomUUID();
}

/** Generates an opaque, URL-safe verification reference for issued documents. */
export function newVerificationRef(): string {
  return randomUUID().replace(/-/g, "");
}
