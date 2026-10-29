import { useState } from "react";
import { requestMagicLink, startGoogleSignIn } from "../auth";
import { getConfig } from "../config";

export function SignIn(props: { next: string; heading?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "throttled">("idle");
  const [error, setError] = useState<string>();
  const { googleEnabled } = getConfig();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setState("sending");
    try {
      setState(await requestMagicLink(email.trim().toLowerCase(), props.next));
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "sent" || state === "throttled") {
    return (
      <main className="page narrow">
        <h1>Check your email</h1>
        <p>
          {state === "sent" ? "We sent a sign-in link to " : "A sign-in link was just sent to "}
          <strong>{email}</strong>. Open it on any device to sign in. It works once and expires in 15 minutes.
        </p>
        <button className="link" onClick={() => setState("idle")}>
          Use a different email
        </button>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>{props.heading ?? "Sign in to Worklight"}</h1>
      <p className="muted">No password needed. We'll email you a link.</p>
      <form onSubmit={submit} className="stack">
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending..." : "Email me a sign-in link"}
        </button>
      </form>
      {googleEnabled && (
        <>
          <p className="divider">or</p>
          <button className="secondary" onClick={() => startGoogleSignIn(props.next)}>
            Continue with Google
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
