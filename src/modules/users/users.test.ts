import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { UsersService } from "./users.js";
import { PermissionService } from "../permission/permission.js";
import { AppError } from "../../shared/errors.js";

function makeService() {
  const perms = new PermissionService();
  perms.registerRole({ id: "role-a", name: "A" });
  const users = new UsersService(perms, () => {});
  return { perms, users };
}

describe("UsersService", () => {
  // Feature: calibration-services-platform, Property 3: User creation persists
  // valid input and round-trips.
  it("Property 3: valid create persists and round-trips identifier + roles", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 255 }).filter((s) => s.trim().length >= 1 && s.trim().length <= 255),
        (identifier) => {
          const { users } = makeService();
          const created = users.createUser({
            identifier,
            credential: "pw",
            roleIds: ["role-a"],
          });
          const read = users.getUser(created.id);
          expect(read.identifier).toBe(identifier.trim());
          expect(read.roleIds).toEqual(["role-a"]);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 4: Invalid or duplicate
  // user creation is rejected with no state change.
  it("Property 4: invalid/duplicate create is rejected with no state change", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("empty-id", "no-roles", "duplicate"),
        (mode) => {
          const { users } = makeService();
          // seed one valid user for the duplicate case
          users.createUser({
            identifier: "existing",
            credential: "pw",
            roleIds: ["role-a"],
          });
          const before = users.listUsers().length;

          const attempt = () => {
            if (mode === "empty-id") {
              users.createUser({ identifier: "   ", credential: "pw", roleIds: ["role-a"] });
            } else if (mode === "no-roles") {
              users.createUser({ identifier: "new", credential: "pw", roleIds: [] });
            } else {
              users.createUser({ identifier: "existing", credential: "pw", roleIds: ["role-a"] });
            }
          };

          expect(attempt).toThrowError(AppError);
          expect(users.listUsers().length).toBe(before);
        }
      ),
      { numRuns: 200 }
    );
  });
});
