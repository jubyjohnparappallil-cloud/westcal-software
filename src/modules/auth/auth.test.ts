import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { AuthService, AuthUser, hashCredential } from "./auth.js";
import { FixedClock } from "../../shared/clock.js";
import { AppError } from "../../shared/errors.js";

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    identifier: "engineer1",
    credentialHash: hashCredential("secret"),
    status: "Active",
    ...overrides,
  };
}

describe("AuthService", () => {
  // Feature: calibration-services-platform, Property 1: Authentication is
  // required for protected access.
  it("Property 1: bad credentials never create a session and are rejected", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.boolean(),
        (identifier, credential, active) => {
          const clock = new FixedClock();
          const user = makeUser({
            identifier: "engineer1",
            credentialHash: hashCredential("secret"),
            status: active ? "Active" : "Deactivated",
          });
          const auth = new AuthService(clock, (id) =>
            id === user.identifier ? user : undefined
          );

          const validMatch =
            identifier === "engineer1" && credential === "secret" && active;

          if (validMatch) {
            const { token } = auth.signIn(identifier, credential);
            expect(auth.resolveSession(token).userId).toBe("u1");
          } else {
            expect(() => auth.signIn(identifier, credential)).toThrowError(
              AppError
            );
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  // Feature: calibration-services-platform, Property 2: Sessions become invalid
  // under any invalidating condition.
  it("Property 2: session invalid after timeout, sign-out, or deactivation", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("timeout", "signout", "deactivate", "none"),
        fc.integer({ min: 0, max: 60 }),
        (condition, idleMinutes) => {
          const clock = new FixedClock();
          const user = makeUser();
          const auth = new AuthService(clock, () => user);
          const { token } = auth.signIn(user.identifier, "secret");

          if (condition === "timeout") {
            clock.advanceMinutes(idleMinutes);
            const shouldExpire = idleMinutes >= 30;
            if (shouldExpire) {
              expect(() => auth.resolveSession(token)).toThrowError(AppError);
            } else {
              expect(auth.resolveSession(token).userId).toBe(user.id);
            }
          } else if (condition === "signout") {
            auth.signOut(token);
            expect(() => auth.resolveSession(token)).toThrowError(AppError);
          } else if (condition === "deactivate") {
            auth.terminateAllSessions(user.id);
            expect(() => auth.resolveSession(token)).toThrowError(AppError);
          } else {
            // no invalidating condition, within window -> still valid
            expect(auth.resolveSession(token).userId).toBe(user.id);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("resolving slides the inactivity window", () => {
    const clock = new FixedClock();
    const user = makeUser();
    const auth = new AuthService(clock, () => user);
    const { token } = auth.signIn(user.identifier, "secret");

    clock.advanceMinutes(20);
    expect(auth.resolveSession(token).userId).toBe(user.id); // slides window
    clock.advanceMinutes(20); // 20 min since last activity, still < 30
    expect(auth.resolveSession(token).userId).toBe(user.id);
  });
});
