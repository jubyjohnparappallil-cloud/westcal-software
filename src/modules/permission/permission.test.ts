import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PermissionService, PermissionKey } from "./permission.js";

const actions = ["create", "read", "edit", "delete"] as const;

const permArb = fc.record({
  module: fc.constantFrom("Users", "Jobs", "Certificates", "Training"),
  action: fc.constantFrom(...actions),
});

function permSetKey(p: PermissionKey): string {
  return `${p.module}:${p.action}`;
}

describe("PermissionService", () => {
  // Feature: calibration-services-platform, Property 5: Authorization equals
  // permission presence, with no side effects on denial.
  it("Property 5: authorize iff union of roles holds the (module, action)", () => {
    fc.assert(
      fc.property(
        fc.array(permArb, { maxLength: 8 }),
        permArb,
        (granted, query) => {
          const svc = new PermissionService();
          svc.registerRole({ id: "r1", name: "R1" });
          svc.assignUserRole("u1", "r1");
          svc.setRolePermissions("r1", granted);

          const grantedKeys = new Set(granted.map(permSetKey));
          const expected = grantedKeys.has(permSetKey(query));
          expect(svc.authorize("u1", query.module, query.action)).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 6: Multiple roles grant the
  // union of permissions.
  it("Property 6: effective permissions equal the union across roles", () => {
    fc.assert(
      fc.property(
        fc.array(permArb, { maxLength: 6 }),
        fc.array(permArb, { maxLength: 6 }),
        (permsA, permsB) => {
          const svc = new PermissionService();
          svc.registerRole({ id: "a", name: "A" });
          svc.registerRole({ id: "b", name: "B" });
          svc.assignUserRole("u1", "a");
          svc.assignUserRole("u1", "b");
          svc.setRolePermissions("a", permsA);
          svc.setRolePermissions("b", permsB);

          const expected = new Set<string>([
            ...permsA.map(permSetKey),
            ...permsB.map(permSetKey),
          ]);
          expect(svc.getEffectivePermissions("u1")).toEqual(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 7: Permission assignments
  // round-trip and take effect.
  it("Property 7: saved assignment round-trips and becomes effective", () => {
    fc.assert(
      fc.property(fc.array(permArb, { maxLength: 8 }), (perms) => {
        const svc = new PermissionService();
        svc.registerRole({ id: "r1", name: "R1" });
        svc.assignUserRole("u1", "r1");
        svc.setRolePermissions("r1", perms);

        const expected = new Set(perms.map(permSetKey));
        const readBack = new Set(svc.getRolePermissions("r1").map(permSetKey));
        expect(readBack).toEqual(expected);
        expect(svc.getEffectivePermissions("u1")).toEqual(expected);
      }),
      { numRuns: 200 }
    );
  });
});
