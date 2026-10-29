import { getConfig } from "./config";

interface Session {
  idToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

const SESSION_KEY = "calltime.session";
const PKCE_KEY = "calltime.pkce";

function readSession(): Session | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : undefined;
  } catch {
    return undefined;
  }
}

function saveSession(idToken: string, refreshToken: string, expiresInSeconds: number) {
  const session: Session = { idToken, refreshToken, expiresAt: Date.now() + expiresInSeconds * 1000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

export function isSignedIn(): boolean {
  return readSession() !== undefined;
}

class CognitoError extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message);
  }
}

async function cognito<T>(target: string, body: unknown): Promise<T> {
  const { region } = getConfig();
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(data.__type ?? "Error").split("#").at(-1) ?? "Error";
    throw new CognitoError(type, String(data.message ?? data.Message ?? "Sign-in failed"));
  }
  return data as T;
}

interface ChallengeResponse {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
}

function throwawayPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  // Never used to sign in; only satisfies the pool's password policy at sign-up.
  return `${btoa(String.fromCharCode(...bytes))}aA1!`;
}

async function ensureUser(email: string) {
  try {
    await cognito("SignUp", {
      ClientId: getConfig().userPoolClientId,
      Username: email,
      Password: throwawayPassword(),
      UserAttributes: [{ Name: "email", Value: email }],
    });
  } catch (err) {
    if (!(err instanceof CognitoError && err.type === "UsernameExistsException")) throw err;
  }
}

async function startCustomAuth(email: string): Promise<ChallengeResponse> {
  return cognito<ChallengeResponse>("InitiateAuth", {
    AuthFlow: "CUSTOM_AUTH",
    ClientId: getConfig().userPoolClientId,
    AuthParameters: { USERNAME: email },
  });
}

/** Emails a sign-in link. Resolves to "throttled" if one was sent in the last minute. */
export async function requestMagicLink(email: string, next = "/"): Promise<"sent" | "throttled"> {
  await ensureUser(email);
  const first = await startCustomAuth(email);
  const res = await cognito<ChallengeResponse>("RespondToAuthChallenge", {
    ClientId: getConfig().userPoolClientId,
    ChallengeName: "CUSTOM_CHALLENGE",
    Session: first.Session,
    ChallengeResponses: { USERNAME: email, ANSWER: "-" },
    ClientMetadata: { mode: "request", next },
  });
  return res.ChallengeParameters?.step === "email-throttled" ? "throttled" : "sent";
}

/** Exchanges the code from an emailed link for a session. Works on any device. */
export async function redeemMagicLink(email: string, code: string): Promise<void> {
  const first = await startCustomAuth(email);
  try {
    const res = await cognito<ChallengeResponse>("RespondToAuthChallenge", {
      ClientId: getConfig().userPoolClientId,
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: first.Session,
      ChallengeResponses: { USERNAME: email, ANSWER: code },
      ClientMetadata: { mode: "redeem" },
    });
    const result = res.AuthenticationResult;
    if (!result?.RefreshToken) throw new Error("expired");
    saveSession(result.IdToken, result.RefreshToken, result.ExpiresIn);
  } catch {
    throw new Error("This sign-in link has expired or was already used. Request a new one.");
  }
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function startGoogleSignIn(next = "/") {
  const { hostedUiUrl, userPoolClientId } = getConfig();
  if (!hostedUiUrl) throw new Error("Google sign-in is not configured");
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, next }));
  const url = new URL("/oauth2/authorize", hostedUiUrl);
  url.search = new URLSearchParams({
    identity_provider: "Google",
    response_type: "code",
    client_id: userPoolClientId,
    redirect_uri: `${location.origin}/auth/callback`,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  location.assign(url.toString());
}

/** Finishes the Google redirect. Returns the path to continue to. */
export async function finishGoogleSignIn(params: URLSearchParams): Promise<string> {
  const { hostedUiUrl, userPoolClientId } = getConfig();
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? "null") as
    | { verifier: string; state: string; next: string }
    | null;
  sessionStorage.removeItem(PKCE_KEY);
  const code = params.get("code");
  if (!hostedUiUrl || !saved || !code || params.get("state") !== saved.state) {
    throw new Error("Google sign-in didn't complete. Please try again.");
  }
  const res = await fetch(new URL("/oauth2/token", hostedUiUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: userPoolClientId,
      code,
      redirect_uri: `${location.origin}/auth/callback`,
      code_verifier: saved.verifier,
    }),
  });
  if (!res.ok) throw new Error("Google sign-in didn't complete. Please try again.");
  const tokens = (await res.json()) as { id_token: string; refresh_token: string; expires_in: number };
  saveSession(tokens.id_token, tokens.refresh_token, tokens.expires_in);
  return saved.next;
}

let refreshing: Promise<string | undefined> | undefined;

/** A valid ID token, refreshed when it is within a minute of expiry. Undefined when signed out. */
export async function getIdToken(forceRefresh = false): Promise<string | undefined> {
  const session = readSession();
  if (!session) return undefined;
  if (!forceRefresh && session.expiresAt - Date.now() > 60_000) return session.idToken;
  refreshing ??= (async () => {
    try {
      const res = await cognito<ChallengeResponse>("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: getConfig().userPoolClientId,
        AuthParameters: { REFRESH_TOKEN: session.refreshToken },
      });
      const result = res.AuthenticationResult;
      if (!result) throw new Error("No tokens");
      saveSession(result.IdToken, result.RefreshToken ?? session.refreshToken, result.ExpiresIn);
      return result.IdToken;
    } catch {
      signOut();
      return undefined;
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}
