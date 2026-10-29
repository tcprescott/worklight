import { normalizeEmail } from "@call-time/shared";
import { newToken, nowEpoch, sha256 } from "./ids.js";
import { magicLinkEmail, type Mailer } from "./mailer.js";
import type { Store } from "./store.js";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** A new link can't be requested more often than this, which caps email cost per address. */
export const MAGIC_LINK_RESEND_SECONDS = 60;

export interface MagicLinkDeps {
  store: Store;
  mailer: Mailer;
  appUrl: string;
}

export type RequestResult = "sent" | "throttled";

export async function requestMagicLink(deps: MagicLinkDeps, rawEmail: string, redirectPath = "/"): Promise<RequestResult> {
  const email = normalizeEmail(rawEmail);
  const now = nowEpoch();
  const existing = await deps.store.getMagicLink(email);
  if (existing && now - existing.createdAt < MAGIC_LINK_RESEND_SECONDS && existing.expiresAt > now) {
    return "throttled";
  }
  const code = newToken();
  await deps.store.putMagicLink({ email, codeHash: sha256(code), createdAt: now, expiresAt: now + MAGIC_LINK_TTL_SECONDS });
  const url = new URL("/auth/magic", deps.appUrl);
  url.searchParams.set("email", email);
  url.searchParams.set("code", code);
  if (redirectPath.startsWith("/") && !redirectPath.startsWith("//")) url.searchParams.set("next", redirectPath);
  await deps.mailer.send(magicLinkEmail(email, url.toString()));
  return "sent";
}

/** True once per code: a correct, unexpired code is deleted as it is redeemed. */
export async function redeemMagicLink(store: Store, rawEmail: string, code: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  const record = await store.getMagicLink(email);
  if (!record || record.expiresAt < nowEpoch()) return false;
  const hash = sha256(code);
  if (hash !== record.codeHash) return false;
  return store.consumeMagicLink(email, hash);
}
