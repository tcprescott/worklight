import type {
  CreateAuthChallengeTriggerEvent,
  DefineAuthChallengeTriggerEvent,
  VerifyAuthChallengeResponseTriggerEvent,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handler as defineChallenge } from "../src/handlers/auth/define-auth-challenge.js";
import { MAGIC_LINK_RESEND_SECONDS, redeemMagicLink, requestMagicLink } from "../src/lib/magic-link.js";
import { FakeMailer } from "./fake-mailer.js";
import { MemoryStore } from "./memory-store.js";

let store: MemoryStore;
let mailer: FakeMailer;
const deps = () => ({ store, mailer, appUrl: "https://calltime.test" });

beforeEach(() => {
  store = new MemoryStore();
  mailer = new FakeMailer();
  vi.useRealTimers();
});

function codeFromEmail() {
  const url = new URL(mailer.lastLink());
  expect(url.pathname).toBe("/auth/magic");
  return { email: url.searchParams.get("email")!, code: url.searchParams.get("code")!, next: url.searchParams.get("next") };
}

describe("magic links", () => {
  it("emails a link whose code signs in exactly once", async () => {
    expect(await requestMagicLink(deps(), "Pat@Example.org", "/invite/abc")).toBe("sent");
    const { email, code, next } = codeFromEmail();
    expect(email).toBe("pat@example.org");
    expect(next).toBe("/invite/abc");
    expect(store.magicLinks.get(email)?.codeHash).not.toBe(code);

    expect(await redeemMagicLink(store, email, "wrong-code-wrong-code-wrong")).toBe(false);
    expect(await redeemMagicLink(store, email, code)).toBe(true);
    expect(await redeemMagicLink(store, email, code)).toBe(false);
  });

  it("drops redirect targets that leave the site", async () => {
    await requestMagicLink(deps(), "pat@example.org", "//evil.example");
    expect(codeFromEmail().next).toBeNull();
  });

  it("throttles repeat requests to one email a minute", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
    expect(await requestMagicLink(deps(), "pat@example.org")).toBe("sent");
    expect(await requestMagicLink(deps(), "pat@example.org")).toBe("throttled");
    expect(mailer.sent).toHaveLength(1);
    vi.advanceTimersByTime((MAGIC_LINK_RESEND_SECONDS + 1) * 1000);
    expect(await requestMagicLink(deps(), "pat@example.org")).toBe("sent");
    expect(mailer.sent).toHaveLength(2);
  });

  it("expires after 15 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
    await requestMagicLink(deps(), "pat@example.org");
    const { email, code } = codeFromEmail();
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(await redeemMagicLink(store, email, code)).toBe(false);
  });

  it("only the newest link works", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
    await requestMagicLink(deps(), "pat@example.org");
    const first = codeFromEmail();
    vi.advanceTimersByTime(2 * 60 * 1000);
    await requestMagicLink(deps(), "pat@example.org");
    const second = codeFromEmail();
    expect(await redeemMagicLink(store, first.email, first.code)).toBe(false);
    expect(await redeemMagicLink(store, second.email, second.code)).toBe(true);
  });
});

describe("define auth challenge", () => {
  const run = async (session: DefineAuthChallengeTriggerEvent["request"]["session"]) => {
    const event = { request: { session }, response: {} } as unknown as DefineAuthChallengeTriggerEvent;
    return (await (defineChallenge as unknown as (e: typeof event) => Promise<typeof event>)(event)).response;
  };
  const attempt = (challengeResult: boolean) => ({ challengeName: "CUSTOM_CHALLENGE" as const, challengeResult });

  it("starts with a custom challenge", async () => {
    expect(await run([])).toMatchObject({ challengeName: "CUSTOM_CHALLENGE", issueTokens: false });
  });

  it("issues tokens after a correct answer", async () => {
    expect(await run([attempt(true)])).toMatchObject({ issueTokens: true, failAuthentication: false });
  });

  it("asks again after the request step, then gives up", async () => {
    expect(await run([attempt(false)])).toMatchObject({ challengeName: "CUSTOM_CHALLENGE", issueTokens: false });
    expect(await run([attempt(false), attempt(false), attempt(false)])).toMatchObject({ failAuthentication: true });
  });
});

// Keep the trigger event types referenced so a Cognito type change shows up in typecheck.
export type _Triggers = CreateAuthChallengeTriggerEvent | VerifyAuthChallengeResponseTriggerEvent;
