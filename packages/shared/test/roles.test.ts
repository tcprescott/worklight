import { describe, expect, it } from "vitest";
import { canOnShow, canOnTheater, isEmail, isShowRole, keys, normalizeEmail } from "../src/index.js";

describe("show permissions", () => {
  it("lets staff manage the show", () => {
    expect(canOnShow("staff", "members:invite")).toBe(true);
    expect(canOnShow("staff", "schedule:edit")).toBe(true);
    expect(canOnShow("staff", "conflicts:read-all")).toBe(true);
  });

  it("limits cast and crew to their own conflicts", () => {
    for (const role of ["cast", "crew"] as const) {
      expect(canOnShow(role, "show:read")).toBe(true);
      expect(canOnShow(role, "conflicts:edit-own")).toBe(true);
      expect(canOnShow(role, "members:invite")).toBe(false);
      expect(canOnShow(role, "schedule:edit")).toBe(false);
      expect(canOnShow(role, "conflicts:read-all")).toBe(false);
    }
  });

  it("denies everything without a role", () => {
    expect(canOnShow(undefined, "show:read")).toBe(false);
    expect(canOnTheater(undefined, "shows:create")).toBe(false);
  });

  it("lets theater admins create shows", () => {
    expect(canOnTheater("admin", "shows:create")).toBe(true);
  });
});

describe("validation helpers", () => {
  it("recognises roles", () => {
    expect(isShowRole("crew")).toBe(true);
    expect(isShowRole("admin")).toBe(false);
    expect(isShowRole(3)).toBe(false);
  });

  it("checks and normalises email addresses", () => {
    expect(isEmail("Jo@Example.org")).toBe(true);
    expect(isEmail("not an email")).toBe(false);
    expect(normalizeEmail("  Jo@Example.ORG ")).toBe("jo@example.org");
    expect(keys.email("Jo@Example.org").PK).toBe("EMAIL#jo@example.org");
  });

  it("indexes memberships by user", () => {
    expect(keys.member("s1", "u1")).toEqual({ PK: "SHOW#s1", SK: "MEMBER#u1", GSI1PK: "USER#u1", GSI1SK: "SHOW#s1" });
  });
});
