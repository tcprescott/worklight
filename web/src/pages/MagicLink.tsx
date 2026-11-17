import { useEffect, useRef, useState } from "react";
import { redeemMagicLink } from "../auth";
import { navigate } from "../router";
import { Wordmark } from "../shell";
import "./actor/actor.css";

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function MagicLink() {
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev; a link can only be redeemed once.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.search);
    const email = params.get("email");
    const code = params.get("code");
    if (!email || !code) {
      setError("This sign-in link is incomplete. Request a new one.");
      return;
    }
    redeemMagicLink(email, code)
      .then(() => navigate(safeNext(params.get("next")), true))
      .catch((err: Error) => setError(err.message));
  }, []);

  return <AuthStatus error={error} />;
}

/** The brief screen between tapping a sign-in link and landing in the app. */
export function AuthStatus(props: { error?: string }) {
  return (
    <main className="actor-auth">
      <Wordmark />
      <div className="actor-center">
        {props.error ? (
          <>
            <h1 className="title-md">Couldn't sign you in</h1>
            <p>{props.error}</p>
            <a className="btn btn-primary actor-btn-xl" href="/sign-in" style={{ maxWidth: 320 }}>
              Back to sign in
            </a>
          </>
        ) : (
          <p role="status">Signing you in...</p>
        )}
      </div>
    </main>
  );
}
