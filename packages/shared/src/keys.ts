/**
 * Single-table key layout. See the spec's data model section.
 *
 *   THEATER#<id>   META              theater
 *   THEATER#<id>   SHOW#<showId>     show
 *   THEATER#<id>   ADMIN#<userId>    theater admin       (GSI1: USER#<userId> / THEATER#<id>)
 *   SHOW#<showId>  META              pointer to the show's theater
 *   SHOW#<showId>  MEMBER#<userId>   show membership     (GSI1: USER#<userId> / SHOW#<showId>)
 *   USER#<id>      PROFILE           user
 *   EMAIL#<email>  USER              email -> userId lookup
 *   INVITE#<token> META              pending invite (TTL)
 *   MAGIC#<email>  META              pending magic-link code hash (TTL)
 */
export const keys = {
  theater: (theaterId: string) => ({ PK: `THEATER#${theaterId}`, SK: "META" }),
  theaterAdmin: (theaterId: string, userId: string) => ({
    PK: `THEATER#${theaterId}`,
    SK: `ADMIN#${userId}`,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `THEATER#${theaterId}`,
  }),
  show: (theaterId: string, showId: string) => ({ PK: `THEATER#${theaterId}`, SK: `SHOW#${showId}` }),
  showPointer: (showId: string) => ({ PK: `SHOW#${showId}`, SK: "META" }),
  member: (showId: string, userId: string) => ({
    PK: `SHOW#${showId}`,
    SK: `MEMBER#${userId}`,
    GSI1PK: `USER#${userId}`,
    GSI1SK: `SHOW#${showId}`,
  }),
  user: (userId: string) => ({ PK: `USER#${userId}`, SK: "PROFILE" }),
  email: (email: string) => ({ PK: `EMAIL#${normalizeEmail(email)}`, SK: "USER" }),
  invite: (token: string) => ({ PK: `INVITE#${token}`, SK: "META" }),
  magicLink: (email: string) => ({ PK: `MAGIC#${normalizeEmail(email)}`, SK: "META" }),
} as const;

export const prefixes = {
  show: "SHOW#",
  member: "MEMBER#",
  admin: "ADMIN#",
  userGsi: (userId: string) => `USER#${userId}`,
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}
