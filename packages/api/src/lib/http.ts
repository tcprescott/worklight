import type { APIGatewayProxyResultV2 } from "aws-lambda";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = () => new HttpError(401, "Sign in required");
export const forbidden = () => new HttpError(403, "You don't have access to this");
export const notFound = (what = "Not found") => new HttpError(404, what);

export function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export function parseBody(raw: string | undefined, isBase64Encoded = false): Record<string, unknown> {
  if (!raw) return {};
  const text = isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw badRequest("Request body must be a JSON object");
}

export function requireString(body: Record<string, unknown>, field: string, maxLength = 200): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") throw badRequest(`${field} is required`);
  if (value.length > maxLength) throw badRequest(`${field} is too long`);
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string, maxLength = 200): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  if (value.length > maxLength) throw badRequest(`${field} is too long`);
  return value.trim();
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireDate(body: Record<string, unknown>, field: string): string {
  const value = requireString(body, field, 10);
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`${field} must be a date like 2026-11-02`);
  }
  return value;
}

export function requireTimezone(body: Record<string, unknown>, field: string): string {
  const value = requireString(body, field, 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw badRequest(`${field} must be an IANA timezone like America/Chicago`);
  }
  return value;
}
