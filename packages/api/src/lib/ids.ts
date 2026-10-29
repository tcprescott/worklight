import { createHash, randomBytes } from "node:crypto";

/** Short, URL-safe id for theaters, shows and users. */
export function newId(): string {
  return randomBytes(12).toString("base64url");
}

/** Long unguessable token for invite links, magic links and calendar feeds. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export const nowIso = () => new Date().toISOString();
export const nowEpoch = () => Math.floor(Date.now() / 1000);
