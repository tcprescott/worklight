import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FakeMailer } from "./fake-mailer.js";
import { MemoryStore } from "./memory-store.js";

let store: MemoryStore;
let mailer: FakeMailer;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new MemoryStore();
  mailer = new FakeMailer();
  app = createApp({ store, mailer, appUrl: "https://calltime.test" });
});

async function call(
  email: string | undefined,
  method: string,
  path: string,
  body?: unknown,
  verified = true,
): Promise<{ status: number; body: any }> {
  const event = {
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: email ? { email, email_verified: verified ? "true" : "false" } : {}, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
  const res = (await app(event)) as APIGatewayProxyStructuredResultV2;
  return { status: res.statusCode ?? 200, body: res.body ? JSON.parse(res.body) : undefined };
}

async function setUpShow(director = "director@example.org") {
  const theater = await call(director, "POST", "/api/theaters", { name: "Riverside Players" });
  const show = await call(director, "POST", `/api/theaters/${theater.body.theaterId}/shows`, {
    name: "Our Town",
    timezone: "America/Chicago",
    startDate: "2026-11-02",
    endDate: "2027-01-17",
  });
  return { theaterId: theater.body.theaterId as string, showId: show.body.showId as string };
}

async function inviteToken(showId: string, from: string, email: string, role = "cast") {
  const res = await call(from, "POST", `/api/shows/${showId}/invites`, { email, role });
  expect(res.status).toBe(201);
  return mailer.lastLink().split("/invite/")[1]!;
}

describe("identity", () => {
  it("rejects requests without a verified email", async () => {
    expect((await call(undefined, "GET", "/api/me")).status).toBe(401);
    expect((await call("a@example.org", "GET", "/api/me", undefined, false)).status).toBe(401);
  });

  it("maps every sign-in method for one email to the same user", async () => {
    const first = await call("Sam@Example.org", "GET", "/api/me");
    const second = await call("sam@example.org", "GET", "/api/me");
    expect(first.body.user.userId).toBe(second.body.user.userId);
    expect(store.users.size).toBe(1);
  });

  it("saves a display name", async () => {
    await call("sam@example.org", "PATCH", "/api/me", { name: "Sam Rivera" });
    expect((await call("sam@example.org", "GET", "/api/me")).body.user.name).toBe("Sam Rivera");
  });
});

describe("theaters and shows", () => {
  it("makes the creator a theater admin and the show's director", async () => {
    const { showId } = await setUpShow();
    const me = await call("director@example.org", "GET", "/api/me");
    expect(me.body.theaters).toHaveLength(1);
    expect(me.body.shows).toEqual([expect.objectContaining({ role: "staff", title: "Director" })]);
    expect(me.body.shows[0].show.showId).toBe(showId);
  });

  it("only lets theater admins create shows", async () => {
    const { theaterId } = await setUpShow();
    const res = await call("stranger@example.org", "POST", `/api/theaters/${theaterId}/shows`, {
      name: "Hamlet",
      timezone: "America/Chicago",
      startDate: "2026-11-02",
      endDate: "2026-12-01",
    });
    expect(res.status).toBe(403);
  });

  it("validates show dates and timezone", async () => {
    const theater = await call("d@example.org", "POST", "/api/theaters", { name: "T" });
    const base = { name: "S", timezone: "America/Chicago", startDate: "2026-11-02", endDate: "2026-12-01" };
    const path = `/api/theaters/${theater.body.theaterId}/shows`;
    expect((await call("d@example.org", "POST", path, { ...base, timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await call("d@example.org", "POST", path, { ...base, startDate: "11/02/2026" })).status).toBe(400);
    expect((await call("d@example.org", "POST", path, { ...base, endDate: "2026-10-01" })).status).toBe(400);
  });

  it("hides a show from people who aren't in it", async () => {
    const { showId } = await setUpShow();
    expect((await call("stranger@example.org", "GET", `/api/shows/${showId}`)).status).toBe(403);
    expect((await call("stranger@example.org", "GET", `/api/shows/nope`)).status).toBe(404);
  });
});

describe("invites", () => {
  it("emails a link that adds the invitee to the show", async () => {
    const { showId } = await setUpShow();
    const token = await inviteToken(showId, "director@example.org", "Actor@Example.org");
    expect(mailer.sent.at(-1)?.to).toBe("actor@example.org");

    const accepted = await call("actor@example.org", "POST", `/api/invites/${token}/accept`);
    expect(accepted.body).toEqual({ showId, role: "cast" });
    const show = await call("actor@example.org", "GET", `/api/shows/${showId}`);
    expect(show.body.role).toBe("cast");
  });

  it("can only be accepted once, by the invited address", async () => {
    const { showId } = await setUpShow();
    const token = await inviteToken(showId, "director@example.org", "actor@example.org");
    expect((await call("someone-else@example.org", "POST", `/api/invites/${token}/accept`)).status).toBe(403);
    expect((await call("actor@example.org", "POST", `/api/invites/${token}/accept`)).status).toBe(200);
    expect((await call("actor@example.org", "POST", `/api/invites/${token}/accept`)).status).toBe(404);
  });

  it("rejects expired invites", async () => {
    const { showId } = await setUpShow();
    const token = await inviteToken(showId, "director@example.org", "actor@example.org");
    store.invites.get(token)!.expiresAt = 1;
    expect((await call("actor@example.org", "POST", `/api/invites/${token}/accept`)).status).toBe(404);
  });

  it("doesn't let cast invite people or see email addresses", async () => {
    const { showId } = await setUpShow();
    const token = await inviteToken(showId, "director@example.org", "actor@example.org");
    await call("actor@example.org", "POST", `/api/invites/${token}/accept`);

    const invite = await call("actor@example.org", "POST", `/api/shows/${showId}/invites`, { email: "x@example.org" });
    expect(invite.status).toBe(403);

    const asCast = await call("actor@example.org", "GET", `/api/shows/${showId}/members`);
    expect(asCast.body.every((m: { email?: string }) => m.email === undefined)).toBe(true);
    const asStaff = await call("director@example.org", "GET", `/api/shows/${showId}/members`);
    expect(asStaff.body.map((m: { email: string }) => m.email).sort()).toEqual([
      "actor@example.org",
      "director@example.org",
    ]);
  });

  it("never downgrades staff who accept a cast invite", async () => {
    const { showId } = await setUpShow();
    const token = await inviteToken(showId, "director@example.org", "director@example.org", "cast");
    const res = await call("director@example.org", "POST", `/api/invites/${token}/accept`);
    expect(res.body.role).toBe("staff");
  });

  it("validates invite input", async () => {
    const { showId } = await setUpShow();
    const path = `/api/shows/${showId}/invites`;
    expect((await call("director@example.org", "POST", path, { email: "nope" })).status).toBe(400);
    expect((await call("director@example.org", "POST", path, { email: "a@b.org", role: "admin" })).status).toBe(400);
  });
});

describe("routing", () => {
  it("returns 404 and 405 for unknown routes and methods", async () => {
    expect((await call("a@example.org", "GET", "/api/nothing")).status).toBe(404);
    expect((await call("a@example.org", "DELETE", "/api/me")).status).toBe(405);
  });

  it("rejects bodies that aren't JSON objects", async () => {
    const event = {
      rawPath: "/api/theaters",
      body: "not json",
      requestContext: {
        http: { method: "POST" },
        authorizer: { jwt: { claims: { email: "a@example.org", email_verified: true }, scopes: [] } },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
    const res = (await app(event)) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});
